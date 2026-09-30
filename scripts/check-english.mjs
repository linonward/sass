#!/usr/bin/env node
// Fails if any file that ships in the buyer release package contains Chinese text.
//
// The kit's code, comments, test titles, script output and docs are English (see "Hard rules" in
// docs/agent-guide.md); the Chinese UI lives in messages/zh.json. This check keeps it that way.
//
// Which files depends on where it runs:
// - In the template's own repository (recognized by `docs/tasks/`, which never ships): every tracked
//   file except the paths the release package leaves out. That list is read from `exclude_paths` in
//   scripts/release-package.sh — the single source of truth — so it can't drift.
// - In a buyer's project: only `src/core/`, the kit code that docs/agent-guide.md asks you to keep in
//   English so template updates merge cleanly. Your own product code can be in any language.
//
// What counts as Chinese: Han characters, CJK symbols and punctuation (U+3000–U+303F: ideographic
// comma, full stop, corner brackets …) and full-width forms (U+FF01–U+FF60, U+FFE0–U+FFE6:
// full-width comma, parentheses, digits …).
//
// Allowed on purpose:
// - Whole paths in ALLOWED_PATHS below (the Chinese UI strings, zh content, an already-applied
//   migration). Keep this list short.
// - A single line that carries the marker `english-check-allow` (for example
//   `const tag = "<Chinese text>"; // english-check-allow: tests non-ASCII tags`), or the line right after one
//   that carries `english-check-allow-next-line`. Say why in the same comment. Use a marker only when
//   the Chinese is the point (test data, code that handles Chinese text) — a comment example can
//   almost always use another language instead.
//
// Binary files are skipped (a NUL byte, or bytes that aren't valid UTF-8).
//
// Usage: pnpm english:check

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ALLOWED_PATHS = [
  // The Chinese UI.
  /^messages\/zh\.json$/,
  // Chinese-locale content collections (content/<collection>/zh/…).
  /^content\/[^/]+\/zh\//,
  // Already applied on existing databases; migration files are never edited after the fact.
  /^drizzle\/0000_init\.sql$/,
];

const CHINESE = /[\p{Script=Han}\u3000-\u303F\uFF01-\uFF60\uFFE0-\uFFE6]/u;
const MARKER = "english-check-allow";
const NEXT_LINE_MARKER = "english-check-allow-next-line";

/** Reads the `exclude_paths=( … )` array from scripts/release-package.sh. */
export function releaseExcludes(releaseScript) {
  const match = /^exclude_paths=\(\n([\s\S]*?)\n\)/m.exec(releaseScript);
  const paths = match?.[1]
    .split("\n")
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean);
  if (!paths?.length) {
    throw new Error(
      "Could not read exclude_paths from scripts/release-package.sh — if its format changed, update releaseExcludes() in scripts/check-english.mjs.",
    );
  }
  return paths;
}

export const isExcluded = (file, excludes) =>
  excludes.some((p) => file === p || file.startsWith(`${p}/`));

export const isAllowedPath = (file) =>
  ALLOWED_PATHS.some((re) => re.test(file));

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** Returns the file's text, or null for binary content. */
export function decodeText(buffer) {
  if (buffer.subarray(0, 8000).includes(0)) return null;
  try {
    return utf8.decode(buffer);
  } catch {
    return null;
  }
}

/** Lines with Chinese that aren't allowed by a marker: [{ line, text }]. */
export function findChinese(text) {
  const lines = text.split("\n");
  const hits = [];
  lines.forEach((line, i) => {
    if (!CHINESE.test(line)) return;
    if (line.includes(MARKER)) return;
    if (i > 0 && lines[i - 1].includes(NEXT_LINE_MARKER)) return;
    hits.push({ line: i + 1, text: line.trim() });
  });
  return hits;
}

/** The template's own repository has its internal task cards; a buyer's project never does. */
export const isTemplateRepo = (root) =>
  existsSync(path.join(root, "docs/tasks"));

/** In a buyer's project only the kit code under src/core/ is checked. */
export const inBuyerScope = (file) => file.startsWith("src/core/");

export function checkRepo(root) {
  const templateRepo = isTemplateRepo(root);
  const excludes = releaseExcludes(
    readFileSync(path.join(root, "scripts/release-package.sh"), "utf8"),
  );
  const files = execFileSync("git", ["-C", root, "ls-files", "-z"], {
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  const hits = [];
  let scanned = 0;
  for (const file of files) {
    if (isExcluded(file, excludes) || isAllowedPath(file)) continue;
    if (!templateRepo && !inBuyerScope(file)) continue;
    let buffer;
    try {
      buffer = readFileSync(path.join(root, file));
    } catch {
      continue; // tracked but deleted in the working tree
    }
    const text = decodeText(buffer);
    if (text === null) continue;
    scanned++;
    for (const hit of findChinese(text)) hits.push({ file, ...hit });
  }
  return { hits, scanned, templateRepo };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
  const { hits, scanned, templateRepo } = checkRepo(root);
  const scope = templateRepo
    ? "files that ship in the release package"
    : "kit files under src/core/";
  if (hits.length === 0) {
    console.log(`No Chinese text in the ${scanned} ${scope}.`);
  } else {
    for (const { file, line, text } of hits) {
      console.error(
        `${file}:${line}: ${text.length > 160 ? `${text.slice(0, 160)}…` : text}`,
      );
    }
    console.error(
      `\n${hits.length} line(s) with Chinese text in ${scope}.` +
        "\nTranslate them to English. UI copy belongs in messages/*.json. If the Chinese is the point" +
        ` (test data, code that handles Chinese text), add "${MARKER}: <why>" to that line.` +
        "\nSee the header of scripts/check-english.mjs.",
    );
    process.exit(1);
  }
}
