/**
 * Starts a multi-locale build of the site for e2e/i18n.
 *
 * Mirrors the real steps for "adding a locale" and changes no other code:
 *   1. Copy the repo (including uncommitted changes) to a temporary directory
 *   2. Add the test locale to `locales` in src/core/i18n/locales.ts
 *   3. Generate pseudo-translated messages/<locale>.json from messages/en.json (each message
 *      prefixed with `[<locale>] `)
 * Then install dependencies in the copy and start it: a production build in CI, the dev server
 * locally.
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
// .env.local is gitignored and not in the list above, but running locally needs its variables
// (e.g. DATABASE_URL).
files.push(".env.local");
for (const file of files) {
  const from = path.join(root, file);
  if (!fs.existsSync(from)) continue; // deleted but not yet committed
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
  throw new Error("could not find locales in src/core/i18n/locales.ts");
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
// Don't change --prefer-offline back to --offline: the Ubuntu 26 runner mounts /tmp as its own
// tmpfs, and pnpm's default store must live on the same filesystem as the project — so the copy
// ends up with a different (empty) store, and --offline fails immediately with
// ERR_PNPM_NO_OFFLINE_TARBALL. --prefer-offline only allows going online to fill gaps: whatever
// is already in the store is still hard-linked, not downloaded.
run(["install", "--prefer-offline", "--frozen-lockfile"]);

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
