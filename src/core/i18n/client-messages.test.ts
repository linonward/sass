// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import messages from "../../../messages/en.json";
import { clientNamespaces, pickClientMessages } from "./client-messages";

const src = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [full]
      : [];
  });
}

const clientFiles = sourceFiles(src).filter((file) =>
  readFileSync(file, "utf8").includes('"use client"'),
);

describe("clientNamespaces", () => {
  test("covers every namespace used by client components", () => {
    const used = new Set<string>();
    for (const file of clientFiles) {
      const code = readFileSync(file, "utf8");
      // Client components can't call useTranslations() for all messages, or trimming would be pointless.
      expect(code, file).not.toMatch(/useTranslations\(\s*\)/);
      for (const [, namespace] of code.matchAll(
        /useTranslations\(\s*["'`]([A-Za-z]+)/g,
      )) {
        used.add(namespace!);
      }
    }
    expect(used.size).toBeGreaterThan(0);
    expect(
      [...used].filter((ns) => !clientNamespaces.includes(ns as never)),
    ).toEqual([]);
  });

  test("every listed namespace exists", () => {
    for (const namespace of clientNamespaces) {
      expect(messages).toHaveProperty(namespace);
    }
  });

  test("keeps only client namespaces", () => {
    const picked = pickClientMessages(messages);
    expect(Object.keys(picked).sort()).toEqual([...clientNamespaces].sort());
    expect(picked).not.toHaveProperty("Email");
    expect(picked).not.toHaveProperty("Landing");
  });
});

describe("client component accessible names", () => {
  /**
   * Accessible names are copy too: screen reader users hear `sr-only` text and `aria-label`, and
   * mouse users see `title` tooltips. Hard-coded in a component they can't be localized — after a
   * buyer adds a locale those spots stay in English forever, and callers can't override them.
   *
   * So UI primitives always follow "callers pass labels, primitives keep an English fallback":
   * literals are only allowed in the primitive's constants (referenced in source as
   * `{SIDEBAR_LABELS.toggle}` and the like), and callers must pass `t(...)`. This test scans for
   * any new literals.
   */
  test("does not hard-code accessible names", () => {
    for (const file of clientFiles) {
      const code = readFileSync(file, "utf8");
      // Literal `aria-label` / `title`; things like `aria-labelledby` are unaffected.
      expect(code, file).not.toMatch(/\saria-label="/);
      expect(code, file).not.toMatch(/\stitle="/);
      // Literal text directly inside an `sr-only` container (`{t(...)}` expressions and child elements
      // don't match).
      expect(code, file).not.toMatch(/sr-only[^>]*>\s*[A-Za-z]/);
    }
  });
});
