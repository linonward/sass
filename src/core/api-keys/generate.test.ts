import { describe, expect, test } from "vitest";

import {
  API_KEY_PREFIX,
  generateApiKey,
  hashApiKey,
  isApiKeyFormat,
} from "./generate";

describe("generateApiKey", () => {
  test("plaintext is sk_ + 64 hex chars (32 random bytes)", () => {
    const { plaintext } = generateApiKey();
    expect(plaintext).toMatch(/^sk_[0-9a-f]{64}$/);
    expect(plaintext).toHaveLength(API_KEY_PREFIX.length + 64);
  });

  test("prefix is sk_ + the first 8 plaintext chars: enough to recognize, not enough to recover", () => {
    const { plaintext, prefix } = generateApiKey();
    expect(prefix).toBe(plaintext.slice(0, 11));
    expect(prefix).toHaveLength(11);
    expect(plaintext.startsWith(prefix)).toBe(true);
  });

  test("every generated plaintext is different", () => {
    const keys = new Set(
      Array.from({ length: 50 }, () => generateApiKey().plaintext),
    );
    expect(keys.size).toBe(50);
  });

  test("hashedKey is the plaintext's SHA-256 (hex), stable for the same input", () => {
    const { plaintext, hashedKey } = generateApiKey();
    expect(hashApiKey(plaintext)).toBe(hashApiKey(plaintext));
    expect(hashedKey).toBe(hashApiKey(plaintext));
    expect(hashedKey).toMatch(/^[0-9a-f]{64}$/);
    // The hash and the plaintext are different things: the stored value must not reveal the
    // original.
    expect(hashedKey).not.toContain(plaintext.slice(3, 11));
  });

  test("hash implementation matches known vectors", () => {
    // Official test vector for sha256("") (FIPS 180-2): pins that this is standard SHA-256, not
    // something home-made.
    expect(hashApiKey("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    // sha256("abc").
    expect(hashApiKey("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("two different keys hash differently", () => {
    expect(generateApiKey().hashedKey).not.toBe(generateApiKey().hashedKey);
  });
});

describe("isApiKeyFormat", () => {
  test.each([
    [`sk_${"a".repeat(64)}`, true],
    [`sk_${"0123456789abcdef".repeat(4)}`, true],
    // Uppercase hex isn't something we issue: plaintext is always lowercase, and every extra
    // accepted spelling is one more premise for a bypass.
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
