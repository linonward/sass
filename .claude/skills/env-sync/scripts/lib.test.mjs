import assert from "node:assert/strict";
import { test } from "node:test";

import {
  diffColumn,
  diffKeys,
  parseDotenv,
  parseKeys,
  parseWorkflowEnv,
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
    "SECRET_EMPTY",
  ];
  const table = {
    SAME: "a",
    CHANGED: "new",
    NEW: "x",
    SECRET: "real",
  };
  const target = {
    SAME: "a",
    CHANGED: "old",
    UNTRACKED: "present",
    SECRET: VERCEL_SENSITIVE,
    SECRET_EMPTY: VERCEL_SENSITIVE,
    EXTRA: "1",
    VERCEL_ENV: "production",
  };
  assert.deepEqual(diffColumn({ table, target, rows }), [
    { name: "CHANGED", kind: "change" },
    { name: "NEW", kind: "add" },
    { name: "UNTRACKED", kind: "untracked" },
    // Can't be compared: --apply prod writes the table's value again.
    { name: "SECRET", kind: "sensitive" },
    // Empty in the table: left alone, only reported.
    { name: "SECRET_EMPTY", kind: "untracked" },
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

test("parseKeys reads names from .env.example, ignoring values and comments", () => {
  assert.deepEqual(
    parseKeys("# A=commented\nA=\nB=default\nexport C=1\nA=again\n"),
    ["A", "B", "C"],
  );
});

test("diffKeys: .env.example owns the keys, the table only the values", () => {
  assert.deepEqual(
    diffKeys({
      declared: ["A", "B", "NEW"],
      rows: ["A", "B", "INTEGRATION_ONLY"],
    }),
    { missing: ["NEW"], extra: ["INTEGRATION_ONLY"] },
  );
});
