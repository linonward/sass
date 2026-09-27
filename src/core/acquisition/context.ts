import { z } from "zod";

export const ATTRIBUTION_SECONDS = 30 * 24 * 60 * 60;
// Bound both character set and size; never persist arbitrary query strings or URLs.
export const campaignField = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => new TextEncoder().encode(value).length <= 128)
  .regex(/^[\p{L}\p{N} _ .~+\-]+$/u);
const hostname = z
  .string()
  .max(253)
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
  );

/**
 * 快照里的 source 可能是哪些值：utm_source、外部 hostname，或确实没有来源的 direct。
 * 后台报表按它筛选，用的是同一套规则；unknown 是「没有归因行 / 已撤回」那个桶。
 */
export const sourceField = z.union([
  campaignField,
  hostname,
  z.literal("direct"),
  z.literal("unknown"),
]);
export const entrySchema = z.strictObject({
  pathname: z
    .string()
    .min(1)
    .max(256)
    .refine((value) => new TextEncoder().encode(value).length <= 512)
    .regex(/^\/(?!\/)[\p{L}\p{N}/._~%+\-]*$/u),
  referrerHost: hostname.optional(),
  utm_source: campaignField.optional(),
  utm_medium: campaignField.optional(),
  utm_campaign: campaignField.optional(),
  utm_term: campaignField.optional(),
  utm_content: campaignField.optional(),
});
export type EntryContext = z.infer<typeof entrySchema>;
export const attributionSchema = entrySchema.extend({
  capturedAt: z.number().int().nonnegative(),
  source: z.string().min(1).max(253),
});
export type Attribution = z.infer<typeof attributionSchema>;

export function captureEntry(
  input: unknown,
  ownHost: string,
  now = Date.now(),
): Attribution | null {
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return null;
  const entry = parsed.data;
  if (entry.referrerHost === ownHost) delete entry.referrerHost;
  return {
    ...entry,
    capturedAt: now,
    source: entry.utm_source ?? entry.referrerHost ?? "direct",
  };
}

export function isCurrent(attribution: Attribution, now = Date.now()) {
  return (
    attribution.capturedAt <= now &&
    now - attribution.capturedAt < ATTRIBUTION_SECONDS * 1000
  );
}

/** Read just the allowlist into memory, without storing or sending full URLs. */
export function browserEntry(href: string, referrer: string): EntryContext {
  const url = new URL(href);
  const raw: Record<string, string> = { pathname: url.pathname };
  // Invalid campaign values are omitted independently, not saved verbatim.
  for (const key of [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
  ]) {
    const value = campaignField.safeParse(url.searchParams.get(key));
    if (value.success) raw[key] = value.data;
  }
  try {
    const source = new URL(referrer);
    if (
      /^https?:$/.test(source.protocol) &&
      source.hostname !== url.hostname &&
      hostname.safeParse(source.hostname).success
    )
      raw.referrerHost = source.hostname;
  } catch {
    /* No referrer is a normal direct visit. */
  }
  // A route with unsupported characters is not copied into storage.
  return (
    entrySchema.safeParse(raw).data ?? {
      pathname: "/",
      ...Object.fromEntries(
        Object.entries(raw).filter(([key]) => key !== "pathname"),
      ),
    }
  );
}
