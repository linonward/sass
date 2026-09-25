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

describe("clientNamespaces", () => {
  const clientFiles = sourceFiles(src).filter((file) =>
    readFileSync(file, "utf8").includes('"use client"'),
  );

  test("覆盖所有客户端组件用到的命名空间", () => {
    const used = new Set<string>();
    for (const file of clientFiles) {
      const code = readFileSync(file, "utf8");
      // 客户端组件不能用 useTranslations() 取全部文案，否则裁剪就没有意义。
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

  test("列出的命名空间都存在", () => {
    for (const namespace of clientNamespaces) {
      expect(messages).toHaveProperty(namespace);
    }
  });

  test("只保留客户端命名空间", () => {
    const picked = pickClientMessages(messages);
    expect(Object.keys(picked).sort()).toEqual([...clientNamespaces].sort());
    expect(picked).not.toHaveProperty("Email");
    expect(picked).not.toHaveProperty("Landing");
  });
});
