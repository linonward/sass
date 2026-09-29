"use client";

import { useLocale } from "next-intl";
import { useState } from "react";

import { getPathname } from "@/core/i18n/navigation";
import { trackEvents } from "@/core/observability/events";
import { track } from "@/core/observability/track";

export type CheckoutErrorKey =
  | "billing_not_configured"
  | "plan_not_configured"
  | "invalid_plan"
  | "no_customer"
  | "generic";

const KNOWN: readonly string[] = [
  "billing_not_configured",
  "plan_not_configured",
  "invalid_plan",
  "no_customer",
];

/**
 * Start checkout:
 * - Success: go to the provider's checkout page.
 * - Signed out: go to sign-in, then back to /pricing?plan=<id> to continue checkout.
 * - Already subscribed: go to the customer portal; one-time plan already bought: go to the billing page.
 * - Other errors: return an error key for the caller to display.
 */
/**
 * Full-page navigation. Checkout and the customer portal leave the site; sign-in and billing pages use
 * full-page navigation too, so the component doesn't depend on App Router context.
 */
function go(path: string) {
  window.location.assign(new URL(path, window.location.href));
}

export function useCheckout() {
  const locale = useLocale();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<CheckoutErrorKey | null>(null);

  async function start(planId: string) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId, locale }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (response.ok && body.url) {
        // The provider's checkout page (in fake mode, an on-site mock page).
        track(trackEvents.checkoutStarted, { plan: planId });
        go(body.url);
        return;
      }
      if (response.status === 401) {
        // The sign-in page's callbackURL is a full on-site path including the locale prefix.
        const callback = `${getPathname({ href: "/pricing", locale })}?plan=${encodeURIComponent(planId)}`;
        const signIn = getPathname({ href: "/sign-in", locale });
        go(`${signIn}?callbackURL=${encodeURIComponent(callback)}`);
        return;
      }
      if (body.error === "already_subscribed") {
        // The server redirects to the provider's customer portal.
        go("/api/billing/portal");
        return;
      }
      if (body.error === "already_purchased") {
        go(getPathname({ href: "/billing", locale }));
        return;
      }
      setError(
        body.error && KNOWN.includes(body.error)
          ? (body.error as CheckoutErrorKey)
          : "generic",
      );
    } catch {
      setError("generic");
    }
    setPending(false);
  }

  return { start, pending, error };
}
