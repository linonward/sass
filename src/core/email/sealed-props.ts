import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

/**
 * Encrypts sensitive template props in the outbox (verification codes).
 *
 * Why encrypt: verification codes are stored **hashed** in the `verification` table
 * (`storeOTP: "hashed"`), so someone who can only read the database gets no usable code. For the
 * outbox to resend, it has to keep the original — storing it in plain text would undo that
 * protection. So we use AES-256-GCM with a key derived from BETTER_AUTH_SECRET: the database alone
 * isn't enough, you also need the app's secret. The original is cleared from the row once it's
 * sent or discarded (see ./outbox.ts).
 *
 * After BETTER_AUTH_SECRET changes, old rows can't be decrypted — by then they've expired anyway
 * (codes are only valid for a few minutes), so they're treated as send failures.
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
