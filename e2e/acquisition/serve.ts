/** A disposable config-enabled copy, leaving the template's default flags off. */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const port = process.env.ACQUISITION_PORT ?? "3102";
const root = path.resolve(import.meta.dirname, "../..");
const dest = path.join(os.tmpdir(), `sass-acquisition-e2e-${port}`);
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
const config = path.join(dest, "site.config.ts");
const before = fs.readFileSync(config, "utf8");
const after = before.replace(
  "attribution: { enabled: false }",
  "attribution: { enabled: true }",
);
if (before === after) throw new Error("Expected default attribution flag off");
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
