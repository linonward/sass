"use client";

import {
  CircleAlertIcon,
  CircleCheckIcon,
  ClockIcon,
  Loader2Icon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Link } from "@/core/i18n/navigation";
import { buttonVariants } from "@/core/ui/button";
import { EmptyStateIcon } from "@/core/ui/empty-state";

type Result =
  | { status: "pending" }
  | { status: "complete"; planId: string | null; balance?: number }
  | { status: "failed"; planId: string | null };

const FIRST_DELAY = 1000;
const MAX_DELAY = 5000;

/**
 * Success page: polls /api/billing/status until the webhook has written the payment to the database.
 * The interval starts at 1s and backs off by 1.5x up to 5s. After timeoutMs it shows a contact-support
 * message but keeps polling in the background, so the page turns into success on its own if the
 * webhook arrives late. Polling stops when the page is left.
 */
export function CheckoutStatus({
  reference,
  timeoutMs,
  supportEmail,
  planNames,
  nextSteps = {},
}: {
  /** Subscription or order ID the provider appends when redirecting back. */
  reference: {
    subscriptionId?: string;
    orderId?: string;
    planId?: string;
    since?: string;
  };
  timeoutMs: number;
  supportEmail: string;
  planNames: Record<string, string>;
  /**
   * Per-plan replacement next step for the success page (e.g. a plan that sells downloadable files →
   * "Go to downloads"): one line of description plus a primary button that replaces "View billing".
   * Plans without one show billing and the dashboard as usual.
   */
  nextSteps?: Record<string, NextStep>;
}) {
  const t = useTranslations("Billing.success");
  const [result, setResult] = useState<Result>({ status: "pending" });
  const [timedOut, setTimedOut] = useState(false);
  const { subscriptionId, orderId, planId, since } = reference;

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let delay = FIRST_DELAY;
    const query = new URLSearchParams();
    if (subscriptionId) query.set("subscription_id", subscriptionId);
    if (orderId) query.set("order_id", orderId);
    if (!subscriptionId && !orderId && planId && since) {
      query.set("plan", planId);
      query.set("since", since);
    }

    async function poll() {
      try {
        const response = await fetch(`/api/billing/status?${query}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (response.ok) {
          const next = (await response.json()) as Result;
          if (next.status !== "pending") {
            setResult(next);
            return;
          }
        }
      } catch {
        if (controller.signal.aborted) return;
        // Network blip: try again on the next round.
      }
      timer = setTimeout(poll, delay);
      delay = Math.min(delay * 1.5, MAX_DELAY);
    }

    const timeout = setTimeout(() => setTimedOut(true), timeoutMs);
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
      clearTimeout(timeout);
    };
  }, [subscriptionId, orderId, planId, since, timeoutMs]);

  const plan = (id: string | null) => (id && planNames[id]) || "";
  const next =
    result.status === "complete" && result.planId
      ? nextSteps[result.planId]
      : undefined;

  if (result.status === "complete") {
    return (
      <State icon={<CircleCheckIcon />}>
        <h1 className="heading-display text-2xl">{t("completeTitle")}</h1>
        <p className="text-muted-foreground">
          {t("completeDescription", { plan: plan(result.planId) })}
        </p>
        {result.balance !== undefined && (
          <p className="text-sm">{t("credits", { balance: result.balance })}</p>
        )}
        {next && <p className="text-sm">{next.note}</p>}
        <Actions next={next} />
      </State>
    );
  }

  if (result.status === "failed") {
    return (
      <State
        tone="neutral"
        icon={<CircleAlertIcon className="text-destructive" />}
      >
        <h1 className="heading-display text-2xl">{t("failedTitle")}</h1>
        <p className="text-muted-foreground">{t("failedDescription")}</p>
        <Actions />
      </State>
    );
  }

  if (timedOut) {
    return (
      <State tone="neutral" icon={<ClockIcon />}>
        <h1 className="heading-display text-2xl">{t("timeoutTitle")}</h1>
        <p className="text-muted-foreground">
          {t.rich("timeoutDescription", {
            email: supportEmail,
            link: (chunks) => (
              <a
                href={`mailto:${supportEmail}`}
                className="text-primary-text underline underline-offset-4"
              >
                {chunks}
              </a>
            ),
          })}
        </p>
        <Actions />
      </State>
    );
  }

  return (
    <State tone="neutral" icon={<Loader2Icon className="animate-spin" />} busy>
      <h1 className="heading-display text-2xl">{t("processingTitle")}</h1>
      <p className="text-muted-foreground">{t("processingDescription")}</p>
    </State>
  );
}

function State({
  icon,
  tone = "brand",
  busy = false,
  children,
}: {
  icon: React.ReactNode;
  /**
   * Only "done" uses the brand chip; waiting and failure use the neutral chip and let the icon
   * carry the meaning.
   */
  tone?: "brand" | "neutral";
  busy?: boolean;
  children: React.ReactNode;
}) {
  // role=status must stay on the outermost element: the dashboard e2e uses an unscoped
  // getByRole("status") to assert the save notice, and another nested one here would collide.
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy={busy}
      className="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-14 text-center"
    >
      <EmptyStateIcon tone={tone}>{icon}</EmptyStateIcon>
      {children}
    </div>
  );
}

export type NextStep = { note: string; href: string; label: string };

function Actions({ next }: { next?: NextStep }) {
  const t = useTranslations("Billing.success");
  return (
    <div className="mt-4 flex flex-wrap justify-center gap-2">
      <Link href={next?.href ?? "/billing"} className={buttonVariants()}>
        {next?.label ?? t("toBilling")}
      </Link>
      <Link
        href="/dashboard"
        className={buttonVariants({ variant: "outline" })}
      >
        {t("toDashboard")}
      </Link>
    </div>
  );
}
