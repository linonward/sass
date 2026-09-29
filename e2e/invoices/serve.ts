/**
 * A temporary copy with `features.examples.invoices` turned off, to verify that turning it off is
 * really clean (/invoices is 404, no sidebar entry). The switch is on in the default config; the
 * enabled behavior is covered by e2e/invoices.spec.ts in the root suite.
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
// Install dependencies into this copy. Don't change --prefer-offline back to --offline: the
// Ubuntu 26 runner mounts /tmp as its own tmpfs, and pnpm's default store must live on the same
// filesystem as the project — so the copy ends up with a different (empty) store, and --offline
// fails immediately with ERR_PNPM_NO_OFFLINE_TARBALL. --prefer-offline only allows going online
// to fill gaps: whatever is already in the store is still hard-linked, not downloaded.
// Symlinking node_modules in was tried; Turbopack refuses to start:
// "Symlink [project]/node_modules is invalid, it points out of the filesystem root".
execFileSync("pnpm", ["install", "--prefer-offline", "--frozen-lockfile"], {
  cwd: dest,
  stdio: "inherit",
});

// Turn off only this one switch and leave the rest of the config as-is — this verifies exactly
// what a buyer sees after turning it off.
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
