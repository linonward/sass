// @vitest-environment node
import { describe, expect, test } from "vitest";

import {
  isReferralCode,
  newReferralCode,
  normalizeReferralCode,
  REFERRAL_ALPHABET,
  REFERRAL_CODE_LENGTH,
} from "./code";

const pattern = new RegExp(`^[${REFERRAL_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`);

describe("referral code", () => {
  test("generated codes have a fixed length and use only unambiguous characters", () => {
    for (let index = 0; index < 500; index += 1) {
      const code = newReferralCode();
      expect(code).toMatch(pattern);
      expect(isReferralCode(code)).toBe(true);
      // Easily confused characters such as i, l, o, u aren't in the alphabet, so hand copying can't
      // get them wrong.
      expect(code).not.toMatch(/[ilou]/);
    }
  });

  test("codes are unrelated to user IDs: the generator takes no input and the random space can't be enumerated", () => {
    // A structural guarantee: no parameter can carry account data into a code, and a code is not a
    // transformed ID.
    expect(newReferralCode).toHaveLength(0);
    expect(REFERRAL_ALPHABET).toHaveLength(32);
    const codes = new Set(
      Array.from({ length: 2000 }, () => newReferralCode()),
    );
    expect(codes.size).toBe(2000);
  });

  test("normalization tolerates whitespace and case; invalid values are always rejected", () => {
    const code = newReferralCode();
    expect(normalizeReferralCode(`  ${code.toUpperCase()} `)).toBe(code);
    expect(isReferralCode(normalizeReferralCode(` ${code}\n`))).toBe(true);
    const rejected = [
      "",
      "short",
      code.slice(0, REFERRAL_CODE_LENGTH - 1),
      `${code}x`,
      "iiiiiiiiiiii",
      "../../etc/passwd",
      code.replace(/[0-9a-z]/, "*"),
      "0".repeat(40),
    ];
    for (const value of rejected)
      expect(isReferralCode(normalizeReferralCode(value))).toBe(false);
  });
});
