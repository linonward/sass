import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  decodeText,
  findChinese,
  isAllowedPath,
  isExcluded,
  releaseExcludes,
} from "../../../scripts/check-english.mjs";

// Chinese sample text is written as \u escapes so this file itself stays ASCII-only (it ships).
const script = path.resolve(__dirname, "../../../scripts/check-english.mjs");

const releaseScript = `#!/usr/bin/env bash
# comment
exclude_paths=(
  AGENTS.md
  docs/tasks # internal task cards
  docs/plan.md
)
for p in "\${exclude_paths[@]}"; do :; done
`;

describe("releaseExcludes", () => {
  test("reads the exclude_paths array, ignoring comments", () => {
    expect(releaseExcludes(releaseScript)).toEqual([
      "AGENTS.md",
      "docs/tasks",
      "docs/plan.md",
    ]);
  });

  test("fails loudly when the array can't be found", () => {
    expect(() => releaseExcludes("no array here")).toThrow(/exclude_paths/);
  });

  test("the real release script yields the internal docs", async () => {
    const { readFileSync } = await import("node:fs");
    const real = releaseExcludes(
      readFileSync(
        path.resolve(__dirname, "../../../scripts/release-package.sh"),
        "utf8",
      ),
    );
    expect(real).toEqual(
      expect.arrayContaining(["AGENTS.md", "CLAUDE.md", "docs/tasks"]),
    );
  });
});

describe("path rules", () => {
  test("an excluded directory covers everything under it, but not a same-prefix sibling", () => {
    const excludes = ["docs/tasks", "AGENTS.md"];
    expect(isExcluded("docs/tasks/phase-1.md", excludes)).toBe(true);
    expect(isExcluded("AGENTS.md", excludes)).toBe(true);
    expect(isExcluded("docs/tasks-archive.md", excludes)).toBe(false);
    expect(isExcluded("src/AGENTS.md", excludes)).toBe(false);
  });

  test("allowed paths: zh messages, zh content, the initial migration — nothing else", () => {
    expect(isAllowedPath("messages/zh.json")).toBe(true);
    expect(isAllowedPath("content/blog/zh/hello.mdx")).toBe(true);
    expect(isAllowedPath("drizzle/0000_init.sql")).toBe(true);
    expect(isAllowedPath("messages/en.json")).toBe(false);
    expect(isAllowedPath("content/blog/en/hello.mdx")).toBe(false);
    expect(isAllowedPath("drizzle/0001_next.sql")).toBe(false);
  });
});

describe("findChinese", () => {
  test("reports Han characters, CJK punctuation and full-width forms with line numbers", () => {
    const text = [
      "ok",
      "// \u6ce8\u91ca",
      "a\uff0cb",
      "x = \uff11",
      "fine",
    ].join("\n");
    expect(findChinese(text).map((h) => h.line)).toEqual([2, 3, 4]);
  });

  test("latin accents and ordinary symbols are not Chinese", () => {
    expect(findChinese("café · naïve → — “quotes” 50%")).toEqual([]);
  });

  test("a marker on the line, or a next-line marker above it, allows that line only", () => {
    const text = [
      'const tag = "\u4e2d\u6587"; // english-check-allow: test data',
      "// english-check-allow-next-line: splits at the full-width comma",
      'title.indexOf("\uff0c");',
      'other("\uff0c");',
    ].join("\n");
    expect(findChinese(text).map((h) => h.line)).toEqual([4]);
  });
});

describe("decodeText", () => {
  test("returns text for UTF-8 and null for binary", () => {
    expect(decodeText(Buffer.from("\u4e2d\u6587 ok", "utf8"))).toBe(
      "\u4e2d\u6587 ok",
    );
    expect(
      decodeText(Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x01])),
    ).toBeNull();
    expect(decodeText(Buffer.from([0xff, 0xfe, 0xfd]))).toBeNull();
  });
});

describe("the script against a git repo", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function repo(files: Record<string, string | Buffer>) {
    dir = mkdtempSync(path.join(tmpdir(), "check-english-"));
    for (const [file, content] of Object.entries({
      "scripts/release-package.sh": releaseScript,
      ...files,
    })) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), content);
    }
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["add", "-A"], { cwd: dir });
    return spawnSync("node", [script], { cwd: dir, encoding: "utf8" });
  }

  test("passes when only excluded, allowed, marked and binary files contain Chinese", () => {
    const result = repo({
      "AGENTS.md": "# \u5185\u90e8\u6587\u6863",
      "docs/tasks/phase-1.md": "\u4efb\u52a1",
      "messages/zh.json": '{ "hi": "\u4f60\u597d" }',
      "src/a.ts":
        'const t = "\u4e2d\u6587"; // english-check-allow: test data\nexport {};\n',
      "public/image.webp": Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x00, 0xe4, 0xb8, 0xad,
      ]),
      "README.md": "# English only\n",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/No Chinese text/);
  });

  test("template repo: fails and points at the file and line of Chinese anywhere that ships", () => {
    const result = repo({
      "docs/tasks/phase-1.md": "internal",
      "src/features/thing.ts":
        "export const a = 1;\n// \u8fd9\u91cc\u662f\u4e2d\u6587\u6ce8\u91ca\n",
      "docs/guide.md": "Fine.\n",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "src/features/thing.ts:2: // \u8fd9\u91cc\u662f\u4e2d\u6587\u6ce8\u91ca",
    );
    expect(result.stderr).toMatch(
      /1 line\(s\) with Chinese text in files that ship in the release package/,
    );
  });

  test("buyer project (no docs/tasks): product code may use Chinese", () => {
    const result = repo({
      "src/features/mine/page.tsx": "// \u6211\u7684\u4e1a\u52a1\n",
      "docs/notes.md": "\u8bf4\u660e\n",
      "src/core/ok.ts": "export {};\n",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/kit files under src\/core\//);
  });

  test("buyer project: Chinese in the kit code under src/core/ still fails", () => {
    const result = repo({
      "src/core/billing/x.ts": "// \u6ce8\u91ca\n",
      "src/features/mine/page.tsx": "// \u6211\u7684\u4e1a\u52a1\n",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/core/billing/x.ts:1:");
    expect(result.stderr).not.toContain("src/features/mine");
  });

  test("untracked files are not scanned (the package is built from git)", () => {
    const result = repo({
      "docs/tasks/a.md": "x",
      "src/core/ok.ts": "export {};\n",
    });
    writeFileSync(path.join(dir, "src/core/new.ts"), "// \u672a\u63d0\u4ea4\n");
    expect(result.status).toBe(0);
    expect(
      spawnSync("node", [script], { cwd: dir, encoding: "utf8" }).status,
    ).toBe(0);
  });
});
