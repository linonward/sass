#!/usr/bin/env node
/**
 * 发布一个可下载版本（src/features/downloads/）：把文件传到私有 R2，再在 download_releases 记一行。
 *
 * 用法：pnpm downloads:publish <产品 id> <版本> <文件>
 *   例：pnpm downloads:publish template 1.0.0 dist/onwardkit-1.0.0.zip
 *
 * bucket 要保持私有（site.config.ts 的 upload.public 为 false，默认如此）。
 *
 * 读 .env.local（或当前环境）里的 DATABASE_URL 和 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID /
 * R2_SECRET_ACCESS_KEY / R2_BUCKET —— 指向哪个库和 bucket，就发布到哪个站点。发生产版本时
 * 显式传生产的变量，脚本开头会打出目标库主机和 bucket，确认无误再往下看结果。
 *
 * 顺序是先传文件、后写库：写库失败时 bucket 里多一个没人引用的文件，不会出现
 * 「下载页有这个版本、点下去 404」。同一产品重发同一版本 = 覆盖文件、刷新大小，发布时间不变
 * （它决定哪些买家的更新期覆盖这个版本，不能因为重传而后移）。
 *
 * 产品 id 要和 site.config.ts 的 downloads.products[].id 一致；脚本不读站点配置
 * （.mjs 加载不了 TS 配置），写错了下载页不会显示这个版本。
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import pg from "pg";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

function die(message) {
  console.error(message);
  process.exit(1);
}

const [productId, version, file] = process.argv.slice(2);
if (!productId || !version || !file) {
  die("用法：pnpm downloads:publish <产品 id> <版本> <文件>");
}
if (!/^[A-Za-z][A-Za-z0-9]*$/.test(productId)) {
  die(`产品 id 只能是字母和数字、以字母开头，收到 "${productId}"`);
}
if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version)) {
  die(`版本号只能包含字母、数字和 . + -，收到 "${version}"`);
}
if (!existsSync(file) || !statSync(file).isFile()) die(`找不到文件：${file}`);

const {
  DATABASE_URL: databaseUrl,
  R2_ACCOUNT_ID: accountId,
  R2_ACCESS_KEY_ID: accessKeyId,
  R2_SECRET_ACCESS_KEY: secretAccessKey,
  R2_BUCKET: bucket,
} = process.env;
const missing = Object.entries({
  DATABASE_URL: databaseUrl,
  R2_ACCOUNT_ID: accountId,
  R2_ACCESS_KEY_ID: accessKeyId,
  R2_SECRET_ACCESS_KEY: secretAccessKey,
  R2_BUCKET: bucket,
})
  .filter(([, value]) => !value)
  .map(([name]) => name);
if (missing.length) die(`缺少环境变量：${missing.join(", ")}`);

const size = statSync(file).size;
// 路径里带一段随机串：bucket 万一被设成公开（upload.public）或绑了公开域名，
// 文件也猜不到地址，只能经 /api/downloads 签名访问。
const key = `downloads/${productId}/${version}-${crypto.randomUUID()}/${path.basename(file)}`;
console.log(
  `发布 ${productId} ${version}（${(size / 1024 / 1024).toFixed(1)} MB）\n` +
    `  数据库：${new URL(databaseUrl).host}\n  bucket：${bucket}/${key}`,
);

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
  // 与 src/core/upload/storage.ts 一致：路径式地址，只在接口要求时计算校验和。
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
await s3.send(
  new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: createReadStream(file),
    ContentLength: size,
    ContentType: file.endsWith(".zip")
      ? "application/zip"
      : "application/octet-stream",
    ContentDisposition: `attachment; filename="${path.basename(file)}"`,
  }),
);

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const { rows } = await client.query(
    `insert into download_releases (id, product_id, version, object_key, size)
     values ($1, $2, $3, $4, $5)
     on conflict (product_id, version)
     do update set object_key = excluded.object_key, size = excluded.size
     returning id, published_at, (xmax = 0) as inserted`,
    [crypto.randomUUID(), productId, version, key, size],
  );
  const [row] = rows;
  console.log(
    `${row.inserted ? "已发布" : "已覆盖"}：${productId} ${version}，发布时间 ${row.published_at.toISOString()}`,
  );
} finally {
  await client.end();
}
