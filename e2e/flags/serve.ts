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
// The demo site's master switch is false (the template shouldn't render flags out of the box);
// this only turns it on — the three flag definitions, rollout, and adminOnly all use the
// site.config.ts config as-is, so this e2e suite verifies exactly what a buyer sees when they
// turn it on.
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
// Don't change --prefer-offline back to --offline: the Ubuntu 26 runner mounts /tmp as its own
// tmpfs, and pnpm's default store must live on the same filesystem as the project — so the copy
// ends up with a different (empty) store, and --offline fails immediately with
// ERR_PNPM_NO_OFFLINE_TARBALL. --prefer-offline only allows going online to fill gaps: whatever
// is already in the store is still hard-linked, not downloaded.
execFileSync("pnpm", ["install", "--prefer-offline", "--frozen-lockfile"], {
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
