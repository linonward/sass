/**
 * 一份把 `features.examples.invoices` 关掉的临时副本：验证关掉之后真的干净
 *（/invoices 404、侧边栏没有入口）。默认配置下这个开关是开的，
 * 打开时的行为由根套件的 e2e/invoices.spec.ts 覆盖。
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const port = process.env.INVOICES_PORT ?? "3104";
const root = path.resolve(import.meta.dirname, "../..");
const dest = path.join(os.tmpdir(), `sass-invoices-e2e-${port}`);
fs.rmSync(dest, { recursive: true, force: true });
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
for (const file of [...new Set([...files, ".env.local"])]) {
  const from = path.join(root, file);
  if (!fs.existsSync(from)) continue;
  fs.mkdirSync(path.dirname(path.join(dest, file)), { recursive: true });
  fs.copyFileSync(from, path.join(dest, file));
}
// 依赖装到这份副本里（--prefer-offline：store 里有的不下载、额外磁盘只是硬链接，
// 几秒钟；store 里缺的才走网络。原来是 --offline，2026-09 实测在 ubuntu-26.04 的
// runner 上会因为 store 查不到而整条腿挂掉）。
// 试过把 node_modules 软链过来，Turbopack 直接拒绝启动：
// "Symlink [project]/node_modules is invalid, it points out of the filesystem root"。
execFileSync("pnpm", ["install", "--prefer-offline", "--frozen-lockfile"], {
  cwd: dest,
  stdio: "inherit",
});

// 只关这一个开关，其余配置保持原样 —— 验的就是买家关掉它之后看到的样子。
const config = path.join(dest, "site.config.ts");
const before = fs.readFileSync(config, "utf8");
const from = "examples: { invoices: true },";
if (!before.includes(from))
  throw new Error(
    `Expected the invoices example on in site.config.ts: ${from}`,
  );
fs.writeFileSync(
  config,
  before.replace(from, "examples: { invoices: false },"),
);

if (process.env.CI)
  execFileSync("pnpm", ["build"], { cwd: dest, stdio: "inherit" });
const server = spawn(
  "pnpm",
  process.env.CI ? ["start", "-p", port] : ["dev", "-p", port],
  { cwd: dest, stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code ?? 0));
