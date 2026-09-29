import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

/**
 * 给 outbox 里的敏感模板参数（验证码）加密。
 *
 * 为什么要加密：验证码在 `verification` 表里是**哈希**存的（`storeOTP: "hashed"`），
 * 只读得到数据库的人拿不到可用的验证码。outbox 要能补发，就得存原文 —— 明文存等于把
 * 这层保护拆掉。所以用从 BETTER_AUTH_SECRET 派生的密钥做 AES-256-GCM：
 * 光有数据库不够，还得有应用的密钥。发出或作废后原文会从行里清掉（见 ./outbox.ts）。
 *
 * 换了 BETTER_AUTH_SECRET 之后旧行解不开 —— 那时它们本来也过期了（验证码只有几分钟有效），
 * 按发送失败处理。
 */
const INFO = "sass/notification-outbox/v1";

function keyFrom(secret: string) {
  return Buffer.from(hkdfSync("sha256", secret, "", INFO, 32));
}

export type SealedProps = { enc: string };

export function isSealed(value: unknown): value is SealedProps {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SealedProps).enc === "string"
  );
}

export function sealProps(
  props: Record<string, unknown>,
  secret: string,
): SealedProps {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(props), "utf8"),
    cipher.final(),
  ]);
  return {
    enc: Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url"),
  };
}

export function openProps(
  sealed: SealedProps,
  secret: string,
): Record<string, unknown> {
  const raw = Buffer.from(sealed.enc, "base64url");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyFrom(secret),
    raw.subarray(0, 12),
  );
  decipher.setAuthTag(raw.subarray(12, 28));
  const text = Buffer.concat([
    decipher.update(raw.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(text) as Record<string, unknown>;
}
