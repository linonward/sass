import { z } from "zod";

// Loaded indirectly by next.config.ts, which doesn't resolve the `@/` alias, so only relative paths
// work here.
import { requiredWhen } from "../create-env";

type RuntimeEnv = Record<string, string | undefined>;

/**
 * Creem environment: test uses test-api.creem.io (sandbox, test cards), live uses api.creem.io (real
 * charges).
 */
export const creemModes = ["test", "live"] as const;
export type CreemMode = (typeof creemModes)[number];

/**
 * Waffo Pancake environment: test (test cards, no real charges) / prod (real payments). Merchant
 * private keys and product IDs don't carry over between the two; webhooks are also verified against
 * this environment, and events from the other environment are always rejected (see providers/waffo.ts).
 */
export const waffoModes = ["test", "prod"] as const;
export type WaffoMode = (typeof waffoModes)[number];

/**
 * Available payment providers. `site.config.ts`'s `billing.provider` takes its value from here;
 * implementations are in ./providers/.
 */
export const billingProviderNames = [
  "creem",
  "stripe",
  "lemonsqueezy",
  "waffo",
] as const;
export type BillingProviderName = (typeof billingProviderNames)[number];

/** Valid values for `BILLING_PROVIDER`: the real providers plus fake for tests. */
export const billingProviders = [...billingProviderNames, "fake"] as const;

/**
 * Valid values for `ALLOW_FAKE_BILLING`; anything else is rejected by env validation (0 / false are
 * the same as unset).
 */
export const fakeBillingOptInValues = ["1", "true", "0", "false"] as const;

/** Only `next dev` (development) and tests (test) count as non-production runtimes. */
export const nonProductionNodeEnvs = ["development", "test"] as const;

/** Whether the explicit switch allowing fake is on: only `1` / `true` count as on. */
function fakeBillingOptIn(runtimeEnv: RuntimeEnv) {
  const value = runtimeEnv.ALLOW_FAKE_BILLING;
  return value === "1" || value === "true";
}

/**
 * Whether `NODE_ENV` is explicitly a non-production runtime; unset is treated as production (better
 * to refuse).
 */
function isNonProductionRuntime(runtimeEnv: RuntimeEnv) {
  return nonProductionNodeEnvs.some((value) => value === runtimeEnv.NODE_ENV);
}

/** Stripe keys that make real charges (`sk_live_` is a standard key, `rk_live_` a restricted key). */
function isLiveStripeKey(runtimeEnv: RuntimeEnv) {
  return /^(sk|rk)_live_/.test(runtimeEnv.STRIPE_SECRET_KEY ?? "");
}

/**
 * Whether the fake payment provider for tests may be used. Fake's checkout page and webhook are both
 * on-site routes; if they were available in a real deployment, anyone could go through a fake checkout
 * and get plans and credits for free. So by default it's only allowed locally (`next dev`), and every
 * one of these checks is required:
 * - Not on Vercel (any VERCEL_ENV) — hard lock; sites deployed to Vercel always use a real provider;
 * - `CREEM_MODE !== "live"` — hard lock; real-charge mode must never end up on fake payments;
 * - `STRIPE_SECRET_KEY` is not a live key — hard lock, same reason, even with a different provider;
 * - `WAFFO_MODE !== "prod"` — hard lock, same reason;
 * - `NODE_ENV` is development / test — `next build`, `next start` and Docker all run as production,
 *   so self-hosted production is refused by default (before this was tightened, this check was
 *   missing and a self-hosted `next start` would silently allow fake). An unset `NODE_ENV` is treated
 *   as production, so a self-built server that forgets to set it isn't allowed by default.
 *
 * Lemon Squeezy has **no** matching hard lock: it has no test / live environment variable (test mode
 * vs. real payments is a toggle on the store), the API key has no recognizable mode marker (the prefix
 * is identical in both modes), and `LEMONSQUEEZY_STORE_ID` doesn't distinguish them either. With no
 * reliable signal we don't write a fake one — rather than blocking on a guess, we let the Vercel check
 * and the `NODE_ENV` check (production runtimes refused by default) keep doing their job.
 *
 * Explicitly setting `ALLOW_FAKE_BILLING=1` only lifts the `NODE_ENV` check: CI's e2e runs on a
 * production build (`next start`) and needs it; self-hosted deployments should only set it when they
 * explicitly want simulated payments. The other checks are hard locks and it doesn't lift them.
 */
export function fakeBillingAllowed(runtimeEnv: RuntimeEnv) {
  if (runtimeEnv.VERCEL_ENV) return false;
  if (runtimeEnv.CREEM_MODE === "live") return false;
  if (isLiveStripeKey(runtimeEnv)) return false;
  if (runtimeEnv.WAFFO_MODE === "prod") return false;
  return fakeBillingOptIn(runtimeEnv) || isNonProductionRuntime(runtimeEnv);
}

/**
 * Variables for the payments module.
 * - The provider in effect is decided by `BILLING_PROVIDER`, defaulting to `site.config.ts`'s
 *   `billing.provider` (the `provider` parameter); only the keys of the provider **in effect** are
 *   required in production.
 * - `CREEM_API_KEY`, `CREEM_WEBHOOK_SECRET` / `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` /
 *   `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_WEBHOOK_SECRET`, `LEMONSQUEEZY_STORE_ID`:
 *   required when the site has paid plans, runs in Vercel production and that provider is selected;
 *   otherwise they can be left empty, in which case the checkout and webhook endpoints return 503 and
 *   nothing else is affected. Lemon Squeezy's STORE_ID is required too: creating a checkout session
 *   must include the store relationship.
 * - `CREEM_MODE`: defaults to test. Switching to real payments requires explicitly setting live and
 *   swapping in the live-mode key, secret and product IDs.
 * - `WAFFO_MERCHANT_ID`, `WAFFO_PRIVATE_KEY`: Waffo Pancake merchant ID (`MER_`) and API private key,
 *   required under the same rules when waffo is the provider in effect. `WAFFO_MODE` defaults to test;
 *   set prod explicitly for real payments. Private keys and product IDs don't carry over between the
 *   two environments.
 * - `BILLING_PROVIDER`: defaults to `site.config.ts`'s billing.provider (see the provider parameter
 *   below); fake is only usable locally and in CI (see fakeBillingAllowed).
 * - `ALLOW_FAKE_BILLING`: optional, off by default. Setting it explicitly to 1 / true allows fake
 *   (CI's e2e needs it, since e2e runs on a production build); it doesn't allow it on Vercel, with
 *   CREEM_MODE=live or with a live Stripe key.
 * - `BILLING_SUCCESS_TIMEOUT_MS`: how long the success page waits for the webhook; defaults to 60s.
 */
export function billingServerEnv(
  runtimeEnv: RuntimeEnv,
  {
    hasPaidPlans,
    provider,
  }: { hasPaidPlans: boolean; provider: BillingProviderName },
) {
  const required = runtimeEnv.VERCEL_ENV === "production" && hasPaidPlans;
  // Required keys are decided by the provider **actually in effect**: an explicit BILLING_PROVIDER wins
  // (it defaults to provider). Without distinguishing by the selected provider, a site using Creem
  // would be required to set Stripe's keys and the deployment wouldn't start at all.
  const selected = runtimeEnv.BILLING_PROVIDER ?? provider;
  const requiredFor = (name: BillingProviderName) =>
    required && selected === name;
  return {
    CREEM_API_KEY: requiredWhen(requiredFor("creem"), z.string().min(1)),
    CREEM_WEBHOOK_SECRET: requiredWhen(requiredFor("creem"), z.string().min(1)),
    // Lemon Squeezy's three variables: creating a checkout session must include the store
    // relationship, so STORE_ID is required just like the two keys.
    LEMONSQUEEZY_API_KEY: requiredWhen(
      requiredFor("lemonsqueezy"),
      z.string().min(1),
    ),
    LEMONSQUEEZY_WEBHOOK_SECRET: requiredWhen(
      requiredFor("lemonsqueezy"),
      z.string().min(1),
    ),
    LEMONSQUEEZY_STORE_ID: requiredWhen(
      requiredFor("lemonsqueezy"),
      z.string().min(1),
    ),
    CREEM_MODE: z.enum(creemModes).default("test"),
    // Waffo Pancake: merchant ID and API private key from Dashboard → Integration (Settings →
    // Developers).
    // The private key may be PEM, single-line Base64, or contain literal \n (the official SDK
    // normalizes it).
    WAFFO_MERCHANT_ID: requiredWhen(requiredFor("waffo"), z.string().min(1)),
    WAFFO_PRIVATE_KEY: requiredWhen(requiredFor("waffo"), z.string().min(1)),
    WAFFO_MODE: z.enum(waffoModes).default("test"),
    // Stripe keys start with sk_/rk_ (test mode sk_test_, real charges sk_live_); the secret is the
    // whsec_ from `stripe webhook` or the dashboard, and isn't interchangeable with Creem's.
    STRIPE_SECRET_KEY: requiredWhen(requiredFor("stripe"), z.string().min(1)),
    STRIPE_WEBHOOK_SECRET: requiredWhen(
      requiredFor("stripe"),
      z.string().min(1),
    ),
    // fake is only for e2e and local: the checkout page and webhook are simulated by on-site test
    // routes.
    // Setting fake in a disallowed environment (production build, Vercel, CREEM_MODE=live, a live Stripe
    // key) fails at startup; see fakeBillingAllowed.
    BILLING_PROVIDER: z
      .enum(billingProviders)
      .default(provider)
      .refine((value) => value !== "fake" || fakeBillingAllowed(runtimeEnv), {
        message:
          'must be "creem", "stripe", "lemonsqueezy" or "waffo" in a production runtime, on Vercel, when CREEM_MODE=live or WAFFO_MODE=prod, or with a live Stripe secret key (set ALLOW_FAKE_BILLING=1 to override the production check)',
      }),
    // Explicitly allow fake (optional, off by default). Only 1 / true / 0 / false are accepted: a typo
    // errors at startup instead of silently counting as off.
    ALLOW_FAKE_BILLING: z.enum(fakeBillingOptInValues).optional(),
    // How long the success page waits for the webhook before suggesting contacting support.
    // Shortened in e2e.
    BILLING_SUCCESS_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(60_000),
  };
}
