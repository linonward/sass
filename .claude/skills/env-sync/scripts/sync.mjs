#!/usr/bin/env node
// Syncs environment variables from the Feishu base "sass 环境变量" (the single source of truth) to
// the places that use them. Values are never printed; output lists variable names only.
//
//   node .claude/skills/env-sync/scripts/sync.mjs                 check local, ci and prod; exit 1 on drift
//   node .claude/skills/env-sync/scripts/sync.mjs --apply local   write the Local column into .env.local
//   node .claude/skills/env-sync/scripts/sync.mjs --apply prod    write the Prod column to Vercel production
//     --only A,B              limit to these variables
//
// The table is the single source of both keys and values. .env.example (the buyers' list) is only
// checked against it: a key it declares that the table lacks gets a ⚠️ warning.
// Rules: the table overwrites Vercel production and .env.local; empty cells are skipped (never
// deletes anything); ci.yml is only checked (it ships to buyers and holds test values).
// Needs `lark-cli` logged in as you and `vercel` linked to the project (see .claude/skills/env-sync/SKILL.md).

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  diffColumn,
  parseDotenv,
  parseWorkflowEnv,
  parseKeys,
  missingKeys,
  updateDotenv,
} from "./lib.mjs";

const BASE_TOKEN = "Lk9Pb1ogSagQemszfgycPS6nnHc";
const TABLE = "环境变量";
const BASE_URL = `https://linonward.feishu.cn/base/${BASE_TOKEN}`;

const root = path.resolve(import.meta.dirname, "../../../..");
const localFile = path.join(root, ".env.local");
const ciFile = path.join(root, ".github/workflows/ci.yml");
const exampleFile = path.join(root, ".env.example");

const { values: args } = parseArgs({
  options: {
    apply: { type: "string" },
    only: { type: "string" },
  },
});
if (args.apply && !["local", "prod"].includes(args.apply)) {
  console.error('--apply takes "local" or "prod" (ci.yml is check-only).');
  process.exit(2);
}
const only = args.only
  ? new Set(args.only.split(",").map((s) => s.trim()))
  : undefined;

// Every temporary file (table export, pulled production env) lives in one private directory
// that is removed on exit, including on errors.
// lark-cli only writes under the working directory, /tmp or ~/files.
const work = mkdtempSync("/tmp/env-sync-");
process.on("exit", () => rmSync(work, { recursive: true, force: true }));

function run(cmd, argv, opts = {}) {
  try {
    return execFileSync(cmd, argv, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });
  } catch (error) {
    // Only the command name and its stderr: argv and stdout may carry values.
    const detail = String(error.stderr ?? error.message)
      .trim()
      .slice(0, 2000);
    console.error(`${cmd} ${argv.slice(0, 2).join(" ")} failed:\n${detail}`);
    process.exit(2);
  }
}

function readTable() {
  const out = path.join(work, "table.ndjson");
  const summary = JSON.parse(
    run("lark-cli", [
      "base",
      "+record-list",
      "--as",
      "user",
      "--base-token",
      BASE_TOKEN,
      "--table-id",
      TABLE,
      "--field-id",
      "变量名",
      "--field-id",
      "Local",
      "--field-id",
      "CI",
      "--field-id",
      "Prod",
      "--field-id",
      "敏感",
      "--limit",
      "200",
      "--format",
      "ndjson",
      "--output",
      out,
    ]),
  );
  if (summary.ok === false)
    throw new Error(`lark-cli: ${JSON.stringify(summary.error)}`);
  if (summary.data?.has_more)
    throw new Error("More than 200 rows: add paging to readTable().");
  const text = (v) =>
    typeof v === "string"
      ? v
      : Array.isArray(v)
        ? v.map((x) => x.text ?? x).join("")
        : undefined;
  const rows = readFileSync(out, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const table = { names: [], local: {}, ci: {}, prod: {}, sensitive: {} };
  for (const row of rows) {
    const name = text(row["变量名"])?.trim();
    if (!name) continue;
    table.names.push(name);
    table.local[name] = text(row.Local);
    table.ci[name] = text(row.CI);
    table.prod[name] = text(row.Prod);
    table.sensitive[name] = row["敏感"] === true;
  }
  return table;
}

function readProd() {
  if (!existsSync(path.join(root, ".vercel/project.json"))) {
    console.error(
      "This checkout isn't linked to Vercel: run `vercel link` here (or copy .vercel/ from the main checkout).",
    );
    process.exit(2);
  }
  const file = path.join(work, "prod.env");
  run("vercel", ["env", "pull", "--environment=production", "--yes", file]);
  return parseDotenv(readFileSync(file, "utf8"));
}

const filter = (items) =>
  only ? items.filter((i) => only.has(i.name)) : items;

const labels = {
  add: "missing in target",
  change: "differs",
  untracked: "set in target, empty in table (skipped)",
  missing_row: "set in target, no row in table",
};

function report(title, diffs) {
  const shown = filter(diffs);
  if (shown.length === 0) {
    console.log(`${title}: in sync`);
    return 0;
  }
  console.log(`${title}:`);
  for (const kind of Object.keys(labels)) {
    const names = shown.filter((d) => d.kind === kind).map((d) => d.name);
    if (names.length) console.log(`  ${labels[kind]}: ${names.join(", ")}`);
  }
  // Only real differences count as drift; reports about untracked/sensitive values don't.
  return shown.filter((d) => d.kind === "add" || d.kind === "change").length;
}

const table = readTable();
// A key .env.example declares (so the code uses it) but the table doesn't manage yet. Warned on
// every run, whatever the mode; extra table keys (integration- or CI-only) are fine.
const unmanaged = missingKeys({
  declared: parseKeys(readFileSync(exampleFile, "utf8")),
  rows: table.names,
}).filter((n) => !only || only.has(n));
for (const name of unmanaged) {
  console.warn(
    `⚠️  ${name} is in .env.example but not in the table: add a row for it (${BASE_URL}).`,
  );
}
if (unmanaged.length) console.warn("");

const rows = only ? table.names.filter((n) => only.has(n)) : table.names;
const local = existsSync(localFile)
  ? parseDotenv(readFileSync(localFile, "utf8"))
  : {};
const ci = parseWorkflowEnv(readFileSync(ciFile, "utf8"));
const prod = readProd();

const localDiff = diffColumn({ table: table.local, target: local, rows });
const ciDiff = diffColumn({ table: table.ci, target: ci, rows });
const prodDiff = diffColumn({ table: table.prod, target: prod, rows });

if (!args.apply) {
  console.log(`Table: ${BASE_URL}\n`);
  const drift =
    report("local (.env.local)", localDiff) +
    report("ci (.github/workflows/ci.yml, check only)", ciDiff) +
    report("prod (Vercel production)", prodDiff);
  if (drift > 0) {
    console.log(
      "\nApply with --apply local / --apply prod; update ci.yml by hand.",
    );
    process.exit(1);
  }
  process.exit(0);
}

if (args.apply === "local") {
  const changes = filter(localDiff).filter(
    (d) => d.kind === "add" || d.kind === "change",
  );
  if (changes.length === 0) {
    console.log(".env.local already matches the table.");
    process.exit(0);
  }
  const values = Object.fromEntries(
    changes.map((d) => [d.name, table.local[d.name]]),
  );
  const before = existsSync(localFile) ? readFileSync(localFile, "utf8") : "";
  writeFileSync(localFile, updateDotenv(before, values), { mode: 0o600 });
  // `mode` only applies when the file is created; tighten an existing file too.
  chmodSync(localFile, 0o600);
  console.log(`.env.local updated: ${Object.keys(values).join(", ")}`);
  report(
    "remaining",
    localDiff.filter((d) => !(d.name in values)),
  );
  process.exit(0);
}

// --apply prod: the table wins. Every non-empty Prod cell that differs or is missing is written
// (sensitive variables can't be read back, so they always differ); equal values are left alone.
const writable = filter(prodDiff).filter((d) =>
  ["add", "change"].includes(d.kind),
);
if (writable.length === 0) {
  console.log("Vercel production already matches the table.");
  report("prod (Vercel production)", prodDiff);
  process.exit(0);
}
for (const { name } of writable) {
  // Storage type follows the table's 敏感 checkbox too. A sensitive variable can never be read
  // back, so it's rewritten on every --apply prod.
  const sensitive = table.sensitive[name];
  // The value goes in on stdin, not argv, so it never shows up in the process list.
  run(
    "vercel",
    [
      "env",
      "add",
      name,
      "production",
      "--force",
      "--yes",
      sensitive ? "--sensitive" : "--no-sensitive",
    ],
    { input: table.prod[name], stdio: ["pipe", "pipe", "pipe"] },
  );
  console.log(`  set ${name}${sensitive ? " (sensitive)" : ""}`);
}
console.log(
  "Vercel production updated. Redeploy for the new values to take effect.",
);
