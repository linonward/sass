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

describe("客户端组件的可访问名", () => {
  /**
   * 可访问名同样是文案：读屏用户听的是 `sr-only` 文本和 `aria-label`，鼠标用户看的是
   * `title` 悬停提示。写死在组件里就没法本地化 —— 买家新增语言后这几处永远是英文，
   * 调用方也盖不住。
   *
   * 所以 UI 原语一律「调用方传 labels，原语留英文兜底」：字面量只允许出现在原语的
   * 常量里（源码中是 `{SIDEBAR_LABELS.toggle}` 这类引用），调用方传的必须是 `t(...)`。
   * 这条扫的就是别再有字面量。
   */
  test("不写死可访问名", () => {
    for (const file of clientFiles) {
      const code = readFileSync(file, "utf8");
      // 字面量的 `aria-label` / `title`；`aria-labelledby` 这类不受影响。
      expect(code, file).not.toMatch(/\saria-label="/);
      expect(code, file).not.toMatch(/\stitle="/);
      // `sr-only` 容器里直接跟字面量文本（`{t(...)}` 表达式、子元素都不匹配）。
      expect(code, file).not.toMatch(/sr-only[^>]*>\s*[A-Za-z]/);
    }
  });
});
