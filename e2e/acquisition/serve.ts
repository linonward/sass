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
const after = before
  .replace("leads: { enabled: false }", "leads: { enabled: true }")
  .replace("attribution: { enabled: false }", "attribution: { enabled: true }");
if (before === after) throw new Error("Expected default attribution flag off");
fs.writeFileSync(config, after);
// Only this disposable e2e copy stubs external Redis. Production has no bypass.
const limiterPath = path.join(dest, "src/core/acquisition/leads/rate-limit.ts");
const liveLimiter = fs
  .readFileSync(limiterPath, "utf8")
  .replace("export const checkLeadLimit =", "const liveLeadLimit =")
  .replace(
    "export async function checkLeadActionLimit(",
    "async function liveActionLimit(",
  );
fs.writeFileSync(
  limiterPath,
  liveLimiter +
    `
export const checkLeadLimit: typeof liveLeadLimit = async () => ({ ok: true, retryAfter: 0 });
export const checkLeadActionLimit: typeof liveActionLimit = async () => ({ ok: true, retryAfter: 0 });
`,
);
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
