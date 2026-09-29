#!/usr/bin/env node
// Checks whether THIRD-PARTY-NOTICES.md (TPN below) has drifted from the actual dependencies.
//
// Why this exists: TPN is a legal compliance file shipped to buyers with the paid product; it states
// "the versions and licenses **actually** installed after the buyer runs `pnpm install`". Dependabot
// opens dependency PRs every week and TPN doesn't follow along by itself — the end of the file says
// "rerun pnpm licenses list after changing dependencies", but nothing reminds anyone, so the declared
// versions drift further and further from the installed ones. This script is that reminder: CI runs
// it on every PR and fails on drift.
//
// Two checks:
//
//   1. Version table ↔ pnpm-lock.yaml (offline, deterministic, platform-independent)
//      Every package version in the direct-dependency section must equal the version the lockfile
//      resolves for that direct dependency, and the dependency type (prod / dev) must match too.
//      Both directions are checked — a package missing from the table or an extra one (not cleaned
//      up after removing a dependency) both count as drift. A lockfile out of sync with
//      package.json is also caught here.
//
//   2. Licenses ↔ `pnpm licenses list` (needs node_modules; CI has them installed)
//      Only two platform-independent things are verified:
//        - every reported license identifier must have a row in both distribution tables — a license
//          nobody has documented yet needs someone to add a row and explain whether it carries
//          obligations, instead of slipping through silently;
//        - no strong copyleft such as GPL / AGPL / SSPL (the file explicitly says there is none).
//          Only single license identifiers without `AND` / `OR` are checked: a dual license like
//          `(A OR B)` may allow picking the permissive branch, which is a judgment this script can't
//          make for a person, so it's left to a human.
//
//      The package counts in the two distribution tables are **deliberately not compared**: those
//      numbers depend on the optional dependencies installed for the current platform
//      (`@swc/core-*`, `@img/sharp-libvips-*`, `lightningcss-*` …), so numbers generated on macOS
//      will never match on Linux CI (e.g. `@swc/core-darwin-arm64` is `Apache-2.0 AND MIT`, its Linux
//      counterpart isn't). The counts are only printed for reference.
//
// Usage: node scripts/check-notices.mjs      same as pnpm notices:check
//
// How to fix after changing dependencies: run `pnpm licenses list` (full) and
// `pnpm licenses list --prod` to update the two distribution tables, then fix the versions in the
// direct-dependency section one by one per the printed drift, and finally rerun this script.
//
// The section headings and the count sentence matched below are literal text from TPN (currently
// in Chinese); when TPN's wording changes, update the matching strings here in the same change.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(root, file), "utf8");

const NOTICES = "THIRD-PARTY-NOTICES.md";

// Strong-copyleft denylist: this is what TPN means by "no strong copyleft licenses such as GPL, AGPL
// or SSPL".
const STRONG_COPYLEFT =
  /^(A?GPL-|SSPL-|OSL-|CPL-|CPAL-|EUPL-|BUSL-|Commons-Clause|RPL-|QPL-)/i;

const failures = [];
const fail = (message) => failures.push(message);

// ---------------------------------------------------------------------------
// Direct dependencies: package.json + pnpm-lock.yaml

// The lockfile is multi-document YAML (separated by `---`): the first document is pnpm's own tree
// (pnpm version, @pnpm/exe.*), and only the last one belongs to this project. Top-level keys such as
// `importers` / `packages` only appear inside their own document, so scanning each document and
// attributing by indentation is enough — no YAML parser needed.
const LOCK_SECTIONS = new Map([
  ["dependencies", "prod"],
  ["devDependencies", "dev"],
  ["optionalDependencies", "prod"],
]);

const unquote = (value) =>
  /^'.*'$/.test(value) || /^".*"$/.test(value) ? value.slice(1, -1) : value;

// `version: 1.2.3(react@19.3.0)` — the parenthesized part is the peer combination, not part of the
// version.
const cleanVersion = (value) =>
  unquote(value.trim()).replace(/\(.*$/, "").trim();

function lockfileDirectDeps() {
  const found = new Map();
  for (const doc of read("pnpm-lock.yaml").split(/^---\s*$/m)) {
    const lines = doc.split("\n");
    const start = lines.indexOf("importers:");
    if (start === -1) continue;

    let importer = null;
    let section = null;
    let name = null;
    for (let i = start + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.trim() === "") continue;
      const indent = line.length - line.trimStart().length;
      if (indent === 0) break; // next section (packages: / settings: …)
      const entry = /^([^:]+):\s*(.*)$/.exec(line.trim());
      if (!entry) continue;
      const key = unquote(entry[1]);
      const value = entry[2];

      if (indent === 2) {
        importer = key;
        section = null;
        name = null;
      } else if (indent === 4) {
        section = key;
        name = null;
      } else if (indent === 6) {
        name = key;
      } else if (indent === 8 && name && key === "version") {
        const type = LOCK_SECTIONS.get(section);
        // Only the root importer's (`.`) three dependency sections count; skip configDependencies and the
        // like.
        if (importer === "." && type) {
          found.set(name, { version: cleanVersion(value), type });
        }
      }
    }
  }
  return found;
}

function packageJsonDirectDeps() {
  const pkg = JSON.parse(read("package.json"));
  const found = new Map();
  for (const [key, type] of [
    ["dependencies", "prod"],
    ["devDependencies", "dev"],
    ["optionalDependencies", "prod"],
  ]) {
    for (const name of Object.keys(pkg[key] ?? {})) {
      found.set(name, { range: pkg[key][name], type });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// TPN: the three tables in the direct-dependency section

function noticesDirectDeps(md) {
  const start = md.indexOf("## 直接依赖明细");
  if (start === -1) {
    fail(
      `Could not find the "## 直接依赖明细" (direct dependencies) section in ${NOTICES} — if the heading was renamed, update this script too.`,
    );
    return new Map();
  }
  const found = new Map();
  // Tables are padded with spaces to column width, so every cell matches optional whitespace.
  const row = /^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*(prod|dev)\s*\|/;
  for (const line of md.slice(start).split("\n")) {
    const match = row.exec(line);
    if (!match) continue;
    const [, name, version, type] = match;
    if (found.has(name))
      fail(
        `${NOTICES}: ${name} appears twice in the direct-dependency section.`,
      );
    found.set(name, { version: version.trim(), type });
  }
  return found;
}

// The "N dependencies + M devDependencies, K total" sentence above the table is for humans, but
// nobody remembers to update it, so it's verified too (a wording change is an error, so the check
// can't silently stop working).
function checkDeclaredCounts(md, pkg) {
  const match =
    /(\d+)\s*个\s*`dependencies`\s*\+\s*(\d+)\s*个\s*`devDependencies`，共\s*(\d+)\s*个/.exec(
      md,
    );
  if (!match) {
    fail(
      `Could not find the "N 个 \`dependencies\` + M 个 \`devDependencies\`" sentence in the direct-dependency section of ${NOTICES} — if the wording changed, update this script too.`,
    );
    return;
  }
  const [, deps, devDeps, total] = match.map(Number);
  const actual = [
    Object.keys(pkg.dependencies ?? {}).length,
    Object.keys(pkg.devDependencies ?? {}).length,
  ];
  if (
    deps !== actual[0] ||
    devDeps !== actual[1] ||
    total !== actual[0] + actual[1]
  ) {
    fail(
      `${NOTICES} says ${deps} dependencies + ${devDeps} devDependencies (${total} total), ` +
        `but package.json has ${actual[0]} + ${actual[1]} (${actual[0] + actual[1]} total).`,
    );
  }
}

// ---------------------------------------------------------------------------
// Licenses

function pnpmLicenses(args) {
  try {
    return execFileSync("pnpm", ["licenses", "list", ...args, "--json"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      // On Windows pnpm is a .cmd shim, so it has to go through a shell.
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    fail(
      `\`pnpm licenses list ${args.join(" ")}\` failed — run \`pnpm install --frozen-lockfile\` first.\n` +
        String(error.stderr ?? error.message).trim(),
    );
    return null;
  }
}

function licenseDistribution(json) {
  const grouped = JSON.parse(json);
  let entries = 0;
  let versions = 0;
  const ids = new Set(Object.keys(grouped));
  for (const list of Object.values(grouped)) {
    entries += list.length;
    for (const entry of list) versions += entry.versions.length;
  }
  return { ids, entries, versions };
}

// License identifiers listed in the first column of the two distribution tables. Only rows whose
// second column is a number count (the header row holds the column title, and the totals row's first
// column is bold), so headers and totals aren't mistaken for licenses.
function documentedLicenses(md) {
  const ids = new Set();
  for (const [from, to] of [
    ["## 全量依赖树", "## 生产依赖树"],
    ["## 生产依赖树", "## 需要单独说明的许可"],
  ]) {
    const start = md.indexOf(from);
    const end = md.indexOf(to, start + from.length);
    if (start === -1 || end === -1) {
      fail(
        `${NOTICES}: could not find the section between "${from}" and "${to}" — if a heading was renamed, update this script too.`,
      );
      continue;
    }
    for (const line of md.slice(start, end).split("\n")) {
      const match = /^\|\s*([^|*]+?)\s*\|\s*\d+\s*\|/.exec(line);
      if (match) ids.add(match[1]);
    }
  }
  return ids;
}

function checkLicenses(md) {
  const documented = documentedLicenses(md);
  const full = pnpmLicenses([]);
  const prod = pnpmLicenses(["--prod"]);
  if (full === null || prod === null) return;

  const all = licenseDistribution(full);
  const onlyProd = licenseDistribution(prod);

  for (const [label, dist] of [
    ["full", all],
    ["--prod", onlyProd],
  ]) {
    for (const id of dist.ids) {
      if (!documented.has(id)) {
        fail(
          `The ${label} dependency tree has a license missing from both distribution tables of ${NOTICES}: "${id}" — ` +
            `add a row to both the full and the production dependency-tree tables, and explain in the licenses-needing-notes section whether it carries obligations.`,
        );
      }
      // Whether a dual license (`A AND B` / `A OR B`) allows picking the permissive branch is a human
      // judgment; this script doesn't make it.
      if (/[(]|[)]|\s(?:AND|OR)\s/.test(id)) continue;
      if (STRONG_COPYLEFT.test(id)) {
        fail(
          `The ${label} dependency tree has strong-copyleft license "${id}", but ${NOTICES} explicitly says there are no strong copyleft licenses such as GPL, AGPL or SSPL. ` +
            `Either replace this dependency, or have a person reassess and rewrite that sentence.`,
        );
      }
    }
  }

  // Package counts depend on platform-specific optional dependencies; print only, don't compare (see
  // the top of this file).
  console.log(
    `Licenses (measured on this machine, for reference): full ${all.entries} entries / ${all.versions} versions, ` +
      `${all.ids.size} licenses; --prod ${onlyProd.entries} entries / ${onlyProd.versions} versions, ` +
      `${onlyProd.ids.size} licenses.`,
  );
}

// ---------------------------------------------------------------------------

const md = read(NOTICES);

// --- 1. Version table ↔ lockfile ---
const locked = lockfileDirectDeps();
const declaredPkg = packageJsonDirectDeps();
const declaredTpn = noticesDirectDeps(md);

const onlyInLockfile = [...locked.keys()].filter(
  (name) => !declaredPkg.has(name),
);
const onlyInPackageJson = [...declaredPkg.keys()].filter(
  (name) => !locked.has(name),
);
if (onlyInLockfile.length > 0 || onlyInPackageJson.length > 0) {
  fail(
    "Direct dependencies in package.json and pnpm-lock.yaml don't match — run `pnpm install --frozen-lockfile` first; " +
      "if the lockfile really should change, run `pnpm install` and commit the new pnpm-lock.yaml.\n" +
      `  only in the lockfile: ${onlyInLockfile.join(", ") || "(none)"}\n` +
      `  only in package.json: ${onlyInPackageJson.join(", ") || "(none)"}`,
  );
}

for (const [name, { version, type }] of locked) {
  const declared = declaredTpn.get(name);
  if (!declared) {
    fail(
      `${name} is a direct dependency, but it's missing from the direct-dependency section of ${NOTICES}.`,
    );
    continue;
  }
  if (declared.version !== version) {
    fail(
      `${name}: ${NOTICES} says ${declared.version}, pnpm-lock.yaml has ${version}.`,
    );
  }
  if (declared.type !== type) {
    fail(
      `${name}: ${NOTICES} marks it ${declared.type}, package.json has it as ${type}.`,
    );
  }
}

for (const name of declaredTpn.keys()) {
  if (!locked.has(name)) {
    fail(
      `${name} is in the direct-dependency section of ${NOTICES} but is no longer a direct dependency — remove that row.`,
    );
  }
}

checkDeclaredCounts(md, JSON.parse(read("package.json")));

// --- 2. Licenses ↔ pnpm licenses list ---
checkLicenses(md);

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(
    `${NOTICES} has drifted from the actual dependencies in ${failures.length} place(s):\n`,
  );
  for (const message of failures) console.error(`- ${message}`);
  console.error(
    `\nSee the reproduce-and-maintain section at the end of ${NOTICES} for how to fix; then rerun \`pnpm notices:check\`.`,
  );
  process.exit(1);
}

console.log(
  `${NOTICES} matches pnpm-lock.yaml: versions and dependency types of all ${locked.size} direct dependencies line up, ` +
    "and every license is documented in the file with no strong copyleft.",
);
