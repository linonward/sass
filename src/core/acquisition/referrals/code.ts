import { randomBytes } from "node:crypto";
import { z } from "zod";

// 32 字符表 × 12 位 ≈ 60 bit，随机空间远大于用户数，码与用户 ID 之间没有任何可推导关系。
export const REFERRAL_CODE_LENGTH = 12;
// 去掉 i/l/o/u 等易混字符，手抄和口头转述都不容易出错。
export const REFERRAL_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const pattern = new RegExp(`^[${REFERRAL_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`);
export const referralCodeSchema = z.string().regex(pattern);
export function isReferralCode(value: string) {
  return pattern.test(value);
}
export function newReferralCode() {
  // 256 % 32 === 0，逐字节取模不引入偏差。
  let code = "";
  for (const byte of randomBytes(REFERRAL_CODE_LENGTH))
    code += REFERRAL_ALPHABET.charAt(byte % REFERRAL_ALPHABET.length);
  return code;
}
// 链接、聊天消息里复制来的码：去掉空白并按小写归一，码只校验不猜测。
export function normalizeReferralCode(value: string) {
  return value.trim().toLowerCase();
}
