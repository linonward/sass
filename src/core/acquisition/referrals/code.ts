import { randomBytes } from "node:crypto";
import { z } from "zod";

// 32-character alphabet × 12 chars ≈ 60 bits: the random space dwarfs the user count, and nothing
// about a code can be derived from a user ID or vice versa.
export const REFERRAL_CODE_LENGTH = 12;
// Drops easily confused characters such as i/l/o/u, so codes survive being copied by hand or read
// aloud.
export const REFERRAL_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const pattern = new RegExp(`^[${REFERRAL_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`);
export const referralCodeSchema = z.string().regex(pattern);
export function isReferralCode(value: string) {
  return pattern.test(value);
}
export function newReferralCode() {
  // 256 % 32 === 0, so taking each byte modulo the alphabet size adds no bias.
  let code = "";
  for (const byte of randomBytes(REFERRAL_CODE_LENGTH))
    code += REFERRAL_ALPHABET.charAt(byte % REFERRAL_ALPHABET.length);
  return code;
}
// Codes copied from links or chat messages: trim whitespace and lowercase. Codes are only
// validated, never guessed.
export function normalizeReferralCode(value: string) {
  return value.trim().toLowerCase();
}
