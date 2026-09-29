import { env } from "@/core/env";

import siteConfig from "../../../site.config";
import type { BillingProviderName } from "./env";

export type PaymentProcessor = {
  /** Public-facing name (used on legal pages and in receipt notes). */
  name: string;
  /**
   * Whether it's a Merchant of Record: the legal seller that collects taxes and handles refunds and
   * chargebacks.
   */
  merchantOfRecord: boolean;
};

/** Each provider's public name and role. Stripe in standard mode is not an MoR (see docs/billing.md). */
export const paymentProcessors: Record<BillingProviderName, PaymentProcessor> =
  {
    creem: { name: "Creem", merchantOfRecord: true },
    stripe: { name: "Stripe", merchantOfRecord: false },
    lemonsqueezy: { name: "Lemon Squeezy", merchantOfRecord: true },
    waffo: { name: "Waffo Pancake", merchantOfRecord: true },
  };

/**
 * The provider in effect (`BILLING_PROVIDER` first, ignoring fake, falling back to site.config's
 * billing.provider). Legal pages use it for the name, so switching providers in production via env
 * vars updates the legal pages without editing their text.
 */
export function activePaymentProcessor(): PaymentProcessor {
  const provider =
    env.BILLING_PROVIDER === "fake"
      ? siteConfig.billing.provider
      : env.BILLING_PROVIDER;
  return paymentProcessors[provider];
}
