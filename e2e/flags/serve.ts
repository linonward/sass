/** A disposable config-enabled copy, leaving the template's default flags off. */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const port = process.env.FLAGS_PORT ?? "3103";
const root = path.resolve(import.meta.dirname, "../..");
const dest = path.join(os.tmpdir(), `sass-flags-e2e-${port}`);
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
// 演示站点的总开关是 false（模板出厂不该渲染 flag），这里只把它打开 ——
// 三个 flag 的定义、rollout、adminOnly 都用 site.config.ts 里的原样配置，
// 所以这套 e2e 验证的就是买家自己打开时看到的行为。
const config = path.join(dest, "site.config.ts");
const before = fs.readFileSync(config, "utf8");
const flags: [string, string][] = [
  ["userFlags: {\n    enabled: false,", "userFlags: {\n    enabled: true,"],
];
const after = flags.reduce(
  (text, [from, to]) => text.replace(from, to),
  before,
);
for (const [from] of flags)
  if (!before.includes(from))
    throw new Error(`Expected default flag off in site.config.ts: ${from}`);
fs.writeFileSync(config, after);
execFileSync("pnpm", ["install", "--offline", "--frozen-lockfile"], {
  cwd: dest,
  stdio: "inherit",
});
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
