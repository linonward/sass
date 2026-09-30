import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cellText,
  diffColumn,
  missingKeys,
  parseDotenv,
  parseKeys,
  parseWorkflowEnv,
  updateDotenv,
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
    SECRET: "[SENSITIVE]",
    SECRET_EMPTY: "[SENSITIVE]",
    EXTRA: "1",
    VERCEL_ENV: "production",
  };
  assert.deepEqual(diffColumn({ table, target, rows }), [
    { name: "CHANGED", kind: "change" },
    { name: "NEW", kind: "add" },
    { name: "UNTRACKED", kind: "untracked" },
    // A Vercel sensitive value pulls as a placeholder, so it always differs and is rewritten.
    { name: "SECRET", kind: "change" },
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

test("missingKeys: only .env.example keys without a table row", () => {
  assert.deepEqual(
    missingKeys({
      declared: ["A", "B", "NEW"],
      rows: ["A", "B", "INTEGRATION_ONLY"],
    }),
    ["NEW"],
  );
});

test("cellText unwraps Feishu auto-links and keeps everything else", () => {
  assert.equal(cellText("[a@b.com](mailto:a@b.com)"), "a@b.com");
  assert.equal(cellText("[example.com](http://example.com)"), "example.com");
  assert.equal(
    cellText("[https://x.test/v1](https://x.test/v1)"),
    "https://x.test/v1",
  );
  assert.equal(cellText([{ text: "[a@b.com](mailto:a@b.com)" }]), "a@b.com");
  // A link whose text and href disagree is not an auto-link: keep it verbatim.
  assert.equal(cellText("[docs](https://x.test)"), "[docs](https://x.test)");
  assert.equal(cellText("plain"), "plain");
  assert.equal(cellText([{ text: "a" }, "b"]), "ab");
  assert.equal(cellText(null), undefined);
  assert.equal(cellText(true), undefined);
});
