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
  test("生成的码长度固定，只用无歧义字符", () => {
    for (let index = 0; index < 500; index += 1) {
      const code = newReferralCode();
      expect(code).toMatch(pattern);
      expect(isReferralCode(code)).toBe(true);
      // i、l、o、u 这类易混字符不在字符表里，手抄不会抄错。
      expect(code).not.toMatch(/[ilou]/);
    }
  });

  test("码与用户 ID 无关：生成函数没有入参，随机空间不可枚举", () => {
    // 结构上的保证：没有任何参数能把账号信息带进码里，码也不是 ID 的变形。
    expect(newReferralCode).toHaveLength(0);
    expect(REFERRAL_ALPHABET).toHaveLength(32);
    const codes = new Set(
      Array.from({ length: 2000 }, () => newReferralCode()),
    );
    expect(codes.size).toBe(2000);
  });

  test("归一化容错空白与大小写，非法值一律拒绝", () => {
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
