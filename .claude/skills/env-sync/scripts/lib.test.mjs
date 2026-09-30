import assert from "node:assert/strict";
import { test } from "node:test";

import {
  diffColumn,
  parseDotenv,
  parseWorkflowEnv,
  SENSITIVE_MARKER,
  updateDotenv,
  VERCEL_SENSITIVE,
} from "./lib.mjs";

test("parseDotenv reads plain, quoted and empty values", () => {
  assert.deepEqual(
    parseDotenv(
      [
        "# comment",
        "A=1",
        'B="two words"',
        "C='x#y'",
        "EMPTY=",
        "export D=4",
        "lower=ignored",
      ].join("\n"),
    ),
    { A: "1", B: "two words", C: "x#y", D: "4" },
  );
});

test("parseWorkflowEnv keeps the first occurrence and unquotes", () => {
  const yml = [
    "env:",
    '  ALLOW: "1"',
    "  NAME: CI Site",
    "jobs:",
    "  e2e:",
    "    env:",
    "      NAME: other",
    "      DOWNLOADS: ${{ matrix.downloads }}",
  ].join("\n");
  assert.deepEqual(parseWorkflowEnv(yml), {
    ALLOW: "1",
    NAME: "CI Site",
    DOWNLOADS: "${{ matrix.downloads }}",
  });
});

test("diffColumn classifies every case and never proposes deletions", () => {
  const rows = [
    "SAME",
    "CHANGED",
    "NEW",
    "EMPTY_BOTH",
    "UNTRACKED",
    "SECRET",
    "MARKED",
  ];
  const table = {
    SAME: "a",
    CHANGED: "new",
    NEW: "x",
    SECRET: "real",
    MARKED: SENSITIVE_MARKER,
  };
  const target = {
    SAME: "a",
    CHANGED: "old",
    UNTRACKED: "present",
    SECRET: VERCEL_SENSITIVE,
    MARKED: VERCEL_SENSITIVE,
    EXTRA: "1",
    VERCEL_ENV: "production",
  };
  assert.deepEqual(diffColumn({ table, target, rows }), [
    { name: "CHANGED", kind: "change" },
    { name: "NEW", kind: "add" },
    { name: "UNTRACKED", kind: "untracked" },
    { name: "SECRET", kind: "unverifiable", sensitive: true },
    { name: "MARKED", kind: "unverifiable", sensitive: true },
    { name: "EXTRA", kind: "missing_row" },
  ]);
});

test("updateDotenv replaces in place, appends new keys, quotes when needed", () => {
  const before = "# local\nA=1\nB=2\n\n";
  assert.equal(
    updateDotenv(before, { B: "two words", C: 'say "hi"' }),
    '# local\nA=1\nB="two words"\nC="say \\"hi\\""\n',
  );
  // Round trip: what we write parses back to the same values.
  const written = updateDotenv("", { X: 'a "b" #c', Y: "plain" });
  assert.deepEqual(parseDotenv(written), { X: 'a "b" #c', Y: "plain" });
});
