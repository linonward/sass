import { and, eq, gt, inArray, or } from "drizzle-orm";
import { hasLocale } from "next-intl";

import type { Database } from "@/core/db";
import {
  billingCustomers,
  checkoutSessions,
  orders,
  subscriptions,
  user as userTable,
} from "@/core/db/schema";
import { routing } from "@/core/i18n/routing";
import type {
  RateLimitIdentifiers,
  RateLimitResult,
} from "@/core/ratelimit/limiter";
import { localizedPath } from "@/core/seo/urls";

import { getPlan } from "./plans";
import type { PaymentProvider } from "./provider";

/**
 * Page returned to after a successful checkout (without locale prefix). It polls status using the
 * order or subscription ID the provider appends.
 */
export const CHECKOUT_SUCCESS_PATH = "/billing/success";
/**
 * Pricing section returned to when the user abandons checkout. Creem has no cancel URL parameter, so
 * this is only used by other providers.
 */
export const CHECKOUT_CANCEL_PATH = "/#pricing";

/**
 * Placeholder product ID in the template (site.config.ts); checkout isn't allowed until it's
 * replaced with a real ID.
 */
const PLACEHOLDER_PRODUCT = /^prod_placeholder/;

/**
 * Reuse window for checkout sessions. Within it, repeated requests for the same (user, plan) get the
 * same URL instead of creating another order; after it expires a new one is created (a user who
 * abandoned checkout and comes back a while later gets a fresh session).
 */
export const CHECKOUT_SESSION_TTL_MS = 30 * 60 * 1000;

export type BillingError =
  | "billing_not_configured"
  | "invalid_plan"
  | "free_plan"
  | "plan_not_configured"
  | "already_subscribed"
  | "already_purchased"
  | "no_customer"
  | "rate_limited";

export type BillingResult =
  | { ok: true; url: string }
  // rate_limited carries retryAfter (seconds); the route uses it for the Retry-After response header.
  | { ok: false; error: BillingError; status: number; retryAfter?: number };

const fail = (
  error: BillingError,
  status: number,
  retryAfter?: number,
): BillingResult => ({
  ok: false,
  error,
  status,
  ...(retryAfter ? { retryAfter } : {}),
});

/**
 * Create a checkout session for a signed-in user.
 * - Only paid plans configured with a real product ID are allowed.
 * - Rejected (409) if a subscription is still billing; upgrades and plan changes go through the
 *   customer portal. A one-time plan can't be bought again once purchased.
 * - The success page carries the user's current locale prefix.
 */
export async function startCheckout({
  db,
  provider,
  user,
  planId,
  locale,
  origin,
  ip,
  checkRateLimit,
  now = new Date(),
}: {
  db: Database;
  provider: PaymentProvider | null;
  user: { id: string; email: string };
  planId: unknown;
  locale: unknown;
  /** Site root URL, e.g. https://example.com. */
  origin: string;
  ip?: string | null;
  checkRateLimit: (
    policy: string,
    identifiers: RateLimitIdentifiers,
  ) => Promise<RateLimitResult>;
  now?: Date;
}): Promise<BillingResult> {
  if (!provider) return fail("billing_not_configured", 503);

  const plan = typeof planId === "string" ? getPlan(planId) : undefined;
  // Hidden plans can't be bought (existing subscriptions still renew, which doesn't go through here).
  if (!plan || plan.hidden) return fail("invalid_plan", 400);
  if (plan.price === 0) return fail("free_plan", 400);
  if (
    !plan.providerProductId ||
    PLACEHOLDER_PRODUCT.test(plan.providerProductId)
  ) {
    return fail("plan_not_configured", 503);
  }

  // Each call really creates an order at the provider, so rate-limit before going further (placed after
  // argument validation: invalid plans don't consume quota, so we don't accidentally block the same
  // user's legitimate checkouts).
  const limit = await checkRateLimit("checkout", { userId: user.id, ip });
  if (!limit.ok) {
    return fail(
      "rate_limited",
      limit.reason === "limited" ? 429 : 503,
      limit.retryAfter,
    );
  }

  const lang =
    typeof locale === "string" && hasLocale(routing.locales, locale)
      ? locale
      : routing.defaultLocale;
  // Fallback lookup for the success page: plan + checkout time. Some providers don't include an order /
  // subscription ID on redirect (Waffo Pancake, Stripe), so the success page looks for orders by "this
  // user, this plan, after this time" (see ./status.ts). order_id / subscription_id appended by the
  // provider itself still take precedence.
  const successUrl = `${origin}${localizedPath(lang, CHECKOUT_SUCCESS_PATH)}?${new URLSearchParams(
    { plan: plan.id, since: String(now.getTime()) },
  )}`;
  const cancelUrl = `${origin}${localizedPath(lang, "/")}#pricing`;

  // Dedup and mutual exclusion: first lock this user's row (concurrent requests/double-clicks queue
  // here), then recheck for duplicates and unexpired sessions; only if there are none do we create a
  // new order at the provider and record it. See the comment on checkoutSessions (Creem's request_id
  // is not an idempotency key — in testing, the same request_id returned two sessions).
  // Tradeoff: the provider call happens inside the transaction (holding a connection for ~0.5s) —
  // the only "external HTTP inside a transaction" in the repo. Checkout is low-frequency; better a
  // bit more expensive than a double charge.
  return db.transaction(async (tx) => {
    await tx
      .select({ id: userTable.id })
      .from(userTable)
      .where(eq(userTable.id, user.id))
      .for("update");

    if (plan.type === "subscription") {
      const [existing] = await tx
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, user.id),
            or(
              inArray(subscriptions.status, ["active", "past_due"]),
              // Canceled but not yet expired also counts as still in use.
              and(
                eq(subscriptions.status, "canceled"),
                gt(subscriptions.currentPeriodEnd, now),
              ),
            ),
          ),
        )
        .limit(1);
      if (existing) return fail("already_subscribed", 409);
    } else {
      const [existing] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.userId, user.id),
            eq(orders.planId, plan.id),
            eq(orders.status, "paid"),
          ),
        )
        .limit(1);
      if (existing) return fail("already_purchased", 409);
    }

    // Reuse the same session while it's valid: repeated requests (two tabs, repeated clicks, retries)
    // get the same URL, so the user can't pay twice on two pages.
    const [reusable] = await tx
      .select({ url: checkoutSessions.url })
      .from(checkoutSessions)
      .where(
        and(
          eq(checkoutSessions.userId, user.id),
          eq(checkoutSessions.planId, plan.id),
          gt(checkoutSessions.expiresAt, now),
        ),
      )
      .limit(1);
    if (reusable) return { ok: true, url: reusable.url };

    const checkout = await provider.createCheckout({
      userId: user.id,
      planId: plan.id,
      customerEmail: user.email,
      successUrl,
      cancelUrl,
    });
    await tx
      .insert(checkoutSessions)
      .values({
        userId: user.id,
        provider: provider.id,
        planId: plan.id,
        providerSessionId: checkout.checkoutId,
        url: checkout.url,
        expiresAt: new Date(now.getTime() + CHECKOUT_SESSION_TTL_MS),
      })
      .onConflictDoUpdate({
        target: [checkoutSessions.userId, checkoutSessions.planId],
        set: {
          provider: provider.id,
          providerSessionId: checkout.checkoutId,
          url: checkout.url,
          expiresAt: new Date(now.getTime() + CHECKOUT_SESSION_TTL_MS),
          updatedAt: new Date(),
        },
      });
    return { ok: true, url: checkout.url };
  });
}

/**
 * Customer portal URL. Returns no_customer when the user has never paid with this provider (no
 * customer record).
 */
export async function openPortal({
  db,
  provider,
  userId,
}: {
  db: Database;
  provider: PaymentProvider | null;
  userId: string;
}): Promise<BillingResult> {
  if (!provider) return fail("billing_not_configured", 503);
  const [customer] = await db
    .select({ id: billingCustomers.providerCustomerId })
    .from(billingCustomers)
    .where(
      and(
        eq(billingCustomers.userId, userId),
        eq(billingCustomers.provider, provider.id),
      ),
    );
  if (!customer) return fail("no_customer", 404);
  return { ok: true, url: await provider.getPortalUrl(customer.id) };
}

/**
 * Site root URL for redirects. Production always uses the configured domain and doesn't trust the
 * Host request header; local and preview use the request's own origin (every preview deployment has
 * a different domain).
 */
export function billingOrigin(
  request: Request,
  runtimeEnv: Record<string, string | undefined>,
  domain: string,
) {
  if (runtimeEnv.VERCEL_ENV === "production") return `https://${domain}`;
  return new URL(request.url).origin;
}
