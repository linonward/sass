/**
 * 启动一个多语言版本的站点，供 e2e/i18n 使用。
 *
 * 模拟"新增一门语言"的真实步骤，除此之外不改任何代码：
 *   1. 把仓库（含未提交改动）复制到临时目录
 *   2. 在 src/core/i18n/locales.ts 的 locales 里加入测试语言
 *   3. 从 messages/en.json 生成伪翻译 messages/<locale>.json（每条加上 `[<locale>] ` 前缀）
 * 然后在副本里安装依赖并启动：CI 用生产构建，本地用 dev server。
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { i18nCopyDir, pseudoTranslate, TEST_LOCALE } from "./test-locale.ts";

const PORT = process.env.I18N_PORT ?? "3001";

const root = path.resolve(import.meta.dirname, "../..");
const dest = i18nCopyDir(PORT);

fs.rmSync(dest, { recursive: true, force: true });
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
// .env.local 被 gitignore，不在上面的列表里，但本地运行需要其中的变量（如 DATABASE_URL）。
files.push(".env.local");
for (const file of files) {
  const from = path.join(root, file);
  if (!fs.existsSync(from)) continue; // 已删除但未提交的文件
  fs.mkdirSync(path.dirname(path.join(dest, file)), { recursive: true });
  fs.copyFileSync(from, path.join(dest, file));
}

const configPath = path.join(dest, "src/core/i18n/locales.ts");
const config = fs.readFileSync(configPath, "utf8");
const patched = config.replace(
  /export const locales = \[([^\]]*)\]/,
  (_, list: string) => `export const locales = [${list}, "${TEST_LOCALE}"]`,
);
if (patched === config)
  throw new Error("src/core/i18n/locales.ts 中找不到 locales");
fs.writeFileSync(configPath, patched);

const en = JSON.parse(
  fs.readFileSync(path.join(root, "messages/en.json"), "utf8"),
);
fs.writeFileSync(
  path.join(dest, `messages/${TEST_LOCALE}.json`),
  JSON.stringify(pseudoTranslate(en), null, 2),
);

const run = (args: string[]) =>
  execFileSync("pnpm", args, { cwd: dest, stdio: "inherit" });
run(["install", "--offline", "--frozen-lockfile"]);

if (process.env.CI) {
  run(["build"]);
}
const server = spawn(
  "pnpm",
  process.env.CI ? ["start", "-p", PORT] : ["dev", "-p", PORT],
  { cwd: dest, stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.kill(signal));
}
server.on("exit", (code) => process.exit(code ?? 0));
