"use client";

import { Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/core/i18n/navigation";
import { cn } from "@/core/lib/utils";
import { Button, buttonVariants } from "@/core/ui/button";

import { useCheckout } from "./use-checkout";

/**
 * The button on a pricing card. The landing page is static and doesn't know whether the visitor is
 * signed in, so `owned` is empty: on click, the checkout endpoint decides whether to go to checkout,
 * sign-in or the customer portal. /pricing passes `owned` and shows the matching state directly.
 */
export function PlanButton({
  planId,
  label,
  free,
  highlighted,
  owned,
}: {
  planId: string;
  label: string;
  free: boolean;
  highlighted: boolean;
  owned?: "subscribed" | "purchased";
}) {
  const t = useTranslations("Billing");
  const { start, pending, error } = useCheckout();
  const variant = highlighted ? "default" : "outline";
  const className = "mt-8 w-full";

  // Free plans need no payment: go straight to the dashboard; signed-out users are sent to sign in
  // by the proxy first.
  if (free) {
    return (
      <Link
        href="/dashboard"
        className={cn(buttonVariants({ size: "lg", variant }), className)}
      >
        {label}
      </Link>
    );
  }
  if (owned === "subscribed") {
    return (
      // The customer portal is a server-side redirect, so this needs a full-page navigation.
      // eslint-disable-next-line @next/next/no-html-link-for-pages
      <a
        href="/api/billing/portal"
        className={cn(buttonVariants({ size: "lg", variant }), className)}
      >
        {t("actions.manage")}
      </a>
    );
  }
  if (owned === "purchased") {
    return (
      <Link
        href="/billing"
        className={cn(
          buttonVariants({ size: "lg", variant: "outline" }),
          className,
        )}
      >
        {t("actions.purchased")}
      </Link>
    );
  }

  return (
    <div className={className}>
      <Button
        type="button"
        size="lg"
        variant={variant}
        className="w-full"
        disabled={pending}
        aria-busy={pending}
        onClick={() => start(planId)}
      >
        {pending && <Loader2Icon className="animate-spin" aria-hidden />}
        {label}
      </Button>
      {error && (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {t(`errors.${error}`)}
        </p>
      )}
    </div>
  );
}
