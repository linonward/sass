// `auth generate` 覆盖式写 src/core/db/schema/auth.ts，会把仓库里手写的「不要手改」提示一起删掉 ——
// 谁跑一次 `pnpm auth:generate` 都会看到一行莫名其妙的 diff。生成后把提示补回第一行（已经有就不动），
// 让 `pnpm auth:generate` 的产物与仓库里的内容一致。调用点见 package.json 的 auth:generate。
import { readFileSync, writeFileSync } from "node:fs";

const header =
  "// 由 Better Auth CLI 生成（pnpm auth:generate），不要手改；改了插件或字段后重新生成再 pnpm db:generate。";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/auth-schema-header.mjs <file>");
  process.exit(1);
}

const source = readFileSync(file, "utf8");
if (!source.startsWith(header)) {
  writeFileSync(file, `${header}\n${source}`);
}
