// Pure helpers for sync.mjs: parsing, diffing and rewriting. No I/O here, so it can be
// tested with `node --test .claude/skills/env-sync/scripts/lib.test.mjs`.

/**
 * What `vercel env pull` writes instead of a sensitive variable's value. Such a value can't be
 * compared, so the table's value is simply written again on every `--apply prod`.
 */
export const VERCEL_SENSITIVE = "[SENSITIVE]";

/** Variables Vercel injects itself; not managed in the table. */
export const isVercelSystemVar = (name) =>
  /^(VERCEL|TURBO|NX)_/.test(name) || name === "VERCEL";

const unquote = (value) => {
  const v = value.trim();
  if (v.length >= 2 && v[0] === v.at(-1) && (v[0] === '"' || v[0] === "'")) {
    const inner = v.slice(1, -1);
    return v[0] === '"'
      ? inner.replace(/\\"/g, '"').replace(/\\n/g, "\n")
      : inner;
  }
  return v;
};

/** Parses a dotenv file into { NAME: value }. Empty values are left out (treated as unset). */
export function parseDotenv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = /^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!m) continue;
    const value = unquote(m[2]);
    if (value !== "") out[m[1]] = value;
  }
  return out;
}

/**
 * Reads `NAME: value` lines from a workflow file (workflow, job and service `env:` blocks). The
 * first occurrence wins, matching the workflow-level block at the top of ci.yml.
 */
export function parseWorkflowEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = /^\s+([A-Z][A-Z0-9_]+):\s*(.+?)\s*$/.exec(line);
    if (m && !(m[1] in out)) out[m[1]] = unquote(m[2]);
  }
  return out;
}

const blank = (v) => v === undefined || v === null || v === "";

/**
 * Compares one table column with what a target environment actually has.
 *
 * - table has a value, target differs → `change` (or `add` when the target lacks it)
 * - table has a value, target's value can't be read (Vercel sensitive) → `sensitive`
 * - table is empty, target has a value → `untracked` (reported, never deleted)
 * - target has a variable the table doesn't list at all → `missing_row`
 */
export function diffColumn({ table, target, rows }) {
  const result = [];
  const listed = new Set(rows);
  for (const name of rows) {
    const want = table[name];
    const have = target[name];
    if (blank(want)) {
      if (!blank(have)) result.push({ name, kind: "untracked" });
      continue;
    }
    if (have === VERCEL_SENSITIVE) result.push({ name, kind: "sensitive" });
    else if (blank(have)) result.push({ name, kind: "add" });
    else if (have !== want) result.push({ name, kind: "change" });
  }
  for (const name of Object.keys(target)) {
    if (!listed.has(name) && !isVercelSystemVar(name)) {
      result.push({ name, kind: "missing_row" });
    }
  }
  return result;
}

const needsQuotes = (value) => /[\s#"'\\]/.test(value) || value.includes("\n");
const formatValue = (value) =>
  needsQuotes(value)
    ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`
    : value;

/**
 * Sets values in a dotenv file's text: existing `NAME=` lines are replaced in place (keeping order
 * and comments), new names are appended. Nothing is removed.
 */
export function updateDotenv(text, values) {
  const pending = new Map(Object.entries(values));
  const lines = text.split("\n").map((line) => {
    const m = /^(?:export\s+)?([A-Z][A-Z0-9_]*)=/.exec(line);
    if (!m || !pending.has(m[1])) return line;
    const value = pending.get(m[1]);
    pending.delete(m[1]);
    return `${m[1]}=${formatValue(value)}`;
  });
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  for (const [name, value] of pending)
    lines.push(`${name}=${formatValue(value)}`);
  return `${lines.join("\n")}\n`;
}
