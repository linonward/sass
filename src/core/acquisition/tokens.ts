import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { attributionSchema, isCurrent, type Attribution } from "./context";
import { referralCodeSchema } from "./referrals/code";

export const SOURCE_CHOICE_COOKIE = "source_preference";
export const SOURCE_COOKIE = "acquisition_source";
export const RETRY_COOKIE = "acquisition_registration";
export const RETRY_SECONDS = 24 * 60 * 60;
// The referral context is stored separately from channel attribution: accepting an invite never
// writes SOURCE_COOKIE, and marketing sources never write here.
export const REFERRAL_COOKIE = "acquisition_referral";
export const REFERRAL_SECONDS = 30 * 24 * 60 * 60;
export const cookieOptions = {
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};
const envelope = z.discriminatedUnion("purpose", [
  z.strictObject({
    v: z.literal(1),
    purpose: z.literal("source"),
    attribution: attributionSchema,
  }),
  z.strictObject({
    v: z.literal(1),
    purpose: z.literal("registration"),
    attribution: attributionSchema,
    userId: z.string().min(1).max(128),
    registeredAt: z.number().int().nonnegative(),
  }),
  z.strictObject({
    v: z.literal(1),
    purpose: z.literal("referral"),
    code: referralCodeSchema,
    acceptedAt: z.number().int().nonnegative(),
  }),
]);
type Envelope = z.infer<typeof envelope>;

export function signContext(value: Envelope, secret: string) {
  const data = Buffer.from(JSON.stringify(value)).toString("base64url");
  const mac = createHmac("sha256", secret)
    .update(`acquisition:${data}`)
    .digest("base64url");
  return `${data}.${mac}`;
}
export function readContext(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): Envelope | null {
  if (!token || token.length > 3800) return null;
  const [data, mac, extra] = token.split(".");
  if (!data || !mac || !/^[A-Za-z0-9_-]{43}$/.test(mac) || extra !== undefined)
    return null;
  const expected = createHmac("sha256", secret)
    .update(`acquisition:${data}`)
    .digest("base64url");
  if (
    mac.length !== expected.length ||
    !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
  )
    return null;
  try {
    const parsed = envelope.safeParse(
      JSON.parse(Buffer.from(data, "base64url").toString()),
    );
    if (!parsed.success) return null;
    const value = parsed.data;
    if (value.purpose === "source")
      return isCurrent(value.attribution, now) ? value : null;
    if (value.purpose === "referral")
      return value.acceptedAt <= now &&
        now - value.acceptedAt < REFERRAL_SECONDS * 1000
        ? value
        : null;
    return value.registeredAt <= now &&
      now - value.registeredAt < RETRY_SECONDS * 1000 &&
      isCurrent(value.attribution, value.registeredAt)
      ? value
      : null;
  } catch {
    return null;
  }
}
export function sourceFromHeaders(
  headers: Headers | undefined,
  secret: string,
  now = Date.now(),
): Attribution | null {
  if (readCookie(headers, SOURCE_CHOICE_COOKIE) === "declined") return null;
  const token = readContext(readCookie(headers, SOURCE_COOKIE), secret, now);
  return token?.purpose === "source" ? token.attribution : null;
}
export function referralFromHeaders(
  headers: Headers | undefined,
  secret: string,
  now = Date.now(),
): { code: string; acceptedAt: number } | null {
  const token = readContext(readCookie(headers, REFERRAL_COOKIE), secret, now);
  return token?.purpose === "referral"
    ? { code: token.code, acceptedAt: token.acceptedAt }
    : null;
}
export function readCookie(headers: Headers | undefined, name: string) {
  return headers
    ?.get("cookie")
    ?.split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
