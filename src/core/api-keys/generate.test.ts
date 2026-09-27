import { describe, expect, test } from "vitest";

import {
  API_KEY_PREFIX,
  generateApiKey,
  hashApiKey,
  isApiKeyFormat,
} from "./generate";

describe("generateApiKey", () => {
  test("明文是 sk_ + 64 位 hex（32 字节随机）", () => {
    const { plaintext } = generateApiKey();
    expect(plaintext).toMatch(/^sk_[0-9a-f]{64}$/);
    expect(plaintext).toHaveLength(API_KEY_PREFIX.length + 64);
  });

  test("prefix 是 sk_ + 明文前 8 位：够在列表里辨认，不足以反推", () => {
    const { plaintext, prefix } = generateApiKey();
    expect(prefix).toBe(plaintext.slice(0, 11));
    expect(prefix).toHaveLength(11);
    expect(plaintext.startsWith(prefix)).toBe(true);
  });

  test("每次生成的明文都不同", () => {
    const keys = new Set(
      Array.from({ length: 50 }, () => generateApiKey().plaintext),
    );
    expect(keys.size).toBe(50);
  });

  test("hashedKey 是明文的 SHA-256（hex），同一输入稳定", () => {
    const { plaintext, hashedKey } = generateApiKey();
    expect(hashApiKey(plaintext)).toBe(hashApiKey(plaintext));
    expect(hashedKey).toBe(hashApiKey(plaintext));
    expect(hashedKey).toMatch(/^[0-9a-f]{64}$/);
    // 哈希和明文是两回事：库里存的值不该带出原文。
    expect(hashedKey).not.toContain(plaintext.slice(3, 11));
  });

  test("哈希实现对得上已知向量", () => {
    // sha256("") 的官方测试向量（FIPS 180-2）：钉住用的是标准 SHA-256，不是自己拼的。
    expect(hashApiKey("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    // sha256("abc")。
    expect(hashApiKey("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("两把不同的 key 哈希不同", () => {
    expect(generateApiKey().hashedKey).not.toBe(generateApiKey().hashedKey);
  });
});

describe("isApiKeyFormat", () => {
  test.each([
    [`sk_${"a".repeat(64)}`, true],
    [`sk_${"0123456789abcdef".repeat(4)}`, true],
    // 大写的 hex 不是我们签发的：明文一律小写，多一种写法就多一种绕过前提。
    [`sk_${"A".repeat(64)}`, false],
    [`sk_${"a".repeat(63)}`, false],
    [`sk_${"a".repeat(65)}`, false],
    [`sk-${"a".repeat(64)}`, false],
    [`sk_${"g".repeat(64)}`, false],
    [`Bearer sk_${"a".repeat(64)}`, false],
    ["", false],
    ["sk_", false],
  ])("%s → %s", (value, expected) => {
    expect(isApiKeyFormat(value)).toBe(expected);
  });
});
