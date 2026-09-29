#!/usr/bin/env node
/**
 * Publishes a downloadable version (src/features/downloads/): uploads the file to private R2, then
 * records a row in download_releases.
 *
 * Usage: pnpm downloads:publish <product id> <version> <file>
 *   e.g. pnpm downloads:publish template 1.0.0 dist/onwardkit-1.0.0.zip
 *
 * The bucket must stay private (upload.public in site.config.ts is false, the default).
 *
 * Reads DATABASE_URL and R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET from
 * .env.local (or the current environment) — whichever database and bucket they point to is the site
 * you publish to. For a production release pass the production variables explicitly; the script
 * prints the target database host and bucket first, so confirm those before reading on.
 *
 * The file is uploaded before the row is written: if the database write fails, the bucket just has
 * an unreferenced file, rather than "the download page lists this version and clicking it 404s".
 * Republishing the same version of the same product = overwrite the file and refresh the size; the
 * publish time stays the same (it decides which customers' update windows cover this version, so a
 * re-upload must not push it later).
 *
 * The product id must match downloads.products[].id in site.config.ts; the script doesn't read the
 * site config (a .mjs file can't load TS config), so with a typo the download page won't show this
 * version.
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
  die("Usage: pnpm downloads:publish <product id> <version> <file>");
}
if (!/^[A-Za-z][A-Za-z0-9]*$/.test(productId)) {
  die(
    `Product id must be letters and digits, starting with a letter; got "${productId}"`,
  );
}
if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version)) {
  die(`Version may only contain letters, digits and . + -; got "${version}"`);
}
if (!existsSync(file) || !statSync(file).isFile())
  die(`File not found: ${file}`);

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
if (missing.length) die(`Missing environment variables: ${missing.join(", ")}`);

const size = statSync(file).size;
// The path includes a random segment: even if the bucket is made public (upload.public) or bound to
// a public domain, the file's URL can't be guessed and is only reachable via signed /api/downloads.
const key = `downloads/${productId}/${version}-${crypto.randomUUID()}/${path.basename(file)}`;
console.log(
  `Publishing ${productId} ${version} (${(size / 1024 / 1024).toFixed(1)} MB)\n` +
    `  database: ${new URL(databaseUrl).host}\n  bucket: ${bucket}/${key}`,
);

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
  // Same as src/core/upload/storage.ts: path-style URLs, checksums only when the API requires them.
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
    `${row.inserted ? "Published" : "Overwrote"}: ${productId} ${version}, published at ${row.published_at.toISOString()}`,
  );
} finally {
  await client.end();
}
