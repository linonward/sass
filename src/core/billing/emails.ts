import { and, eq } from "drizzle-orm";

import { preferredLocale } from "@/core/account/locale";
import { db as defaultDb } from "@/core/db";
import { subscriptions, user } from "@/core/db/schema";
import {
  createOutbox,
  type DatabaseSource,
  type DeliveryRetry,
} from "@/core/email/outbox";
import { siteLink } from "@/core/email/links";
import { claimNotification } from "@/core/email/notification-log";
import { planDisplayName } from "@/core/email/plan-name";
import type { SendEmailOptions } from "@/core/email/send";
import type { SendOptions } from "@/core/email/transports";
import type { EmailTemplateName } from "@/core/email/templates";

import siteConfig from "../../../site.config";
import type { BillingEvent } from "./events";
import type { OnBillingEventHandler } from "./on-billing-event";
import { getPlan } from "./plans";

type BillingTemplate = Extract<
  EmailTemplateName,
  "payment-succeeded" | "payment-failed" | "subscription-canceled"
>;

type EmailSpec = {
  template: BillingTemplate;
  /** Dedup key: the same payment, or the same subscription's cancellation, is notified only once. */
  key: string;
  /** null means send only once; otherwise at most once per window. */
  windowMs: number | null;
};

const DAY = 24 * 60 * 60 * 1000;

/**
 * Billing events → emails:
 *
 * | BillingEvent                                 | Email                 | Dedup                           |
 * | -------------------------------------------- | --------------------- | ------------------------------- |
 * | checkout.completed (one-time, with an order) | payment-succeeded     | order, once                     |
 * | checkout.completed (subscription checkout)   | none                  | handled by subscription.renewed |
 * | subscription.renewed (incl. first period)    | payment-succeeded     | subscription + period, once     |
 * | payment.failed                               | payment-failed        | subscription/order, 1 per 24h   |
 * | subscription.canceled                        | subscription-canceled | subscription, once              |
 * | subscription.active / expired, refund        | none                  |                                 |
 *
 * Old events arriving out of order (stale): payment-succeeded is still sent (the money really came
 * in); payment-failed and cancellations have been superseded by a newer state (e.g. a later successful
 * renewal or reactivation), so we don't bother the user.
 */
export function billingEmailFor(
  event: BillingEvent,
  { stale }: { stale: boolean },
): EmailSpec | null {
  const p = event.provider;
  switch (event.type) {
    case "checkout.completed":
      if (event.subscriptionId || !event.orderId) return null;
      return {
        template: "payment-succeeded",
        key: `${p}:order:${event.orderId}`,
        windowMs: null,
      };
    case "subscription.renewed": {
      const period = event.currentPeriodStart?.toISOString();
      const key = period
        ? `${p}:subscription:${event.subscriptionId}:${period}`
        : `${p}:order:${event.orderId ?? event.eventId}`;
      return { template: "payment-succeeded", key, windowMs: null };
    }
    case "payment.failed":
      if (stale) return null;
      return {
        template: "payment-failed",
        key: `${p}:${event.subscriptionId ?? event.orderId ?? event.eventId}`,
        windowMs: DAY,
      };
    case "subscription.canceled":
      if (stale) return null;
      return {
        template: "subscription-canceled",
        key: `${p}:${event.subscriptionId}`,
        windowMs: null,
      };
    default:
      return null;
  }
}

type Send = <T extends EmailTemplateName>(
  options: SendEmailOptions<T>,
  sendOptions?: SendOptions,
) => Promise<unknown>;

/**
 * onBillingEvent hook that sends billing emails.
 * Inside the event transaction it reads the recipient and claims the dedup slot; the email itself is
 * sent via afterCommit once the transaction commits. So a rolled-back transaction (Creem will retry)
 * sends no email, and repeated deliveries don't fire again thanks to idempotent webhook_events.
 *
 * The email is first written to the outbox (`pending_notifications`) in the same transaction and sent
 * once right after commit; if that fails it stays in the database for the recovery sweep to resend,
 * and only after retries run out is it marked as a terminal failure and the slot released (see
 * `@/core/email/outbox`). So critical emails like payment-succeeded are never lost for good because
 * of a process restart or a single outage.
 * `db` is used for sending and bookkeeping after commit (the transaction has committed by then and
 * can't be used anymore).
 */
export function createBillingEmailHandler({
  send,
  creditsEnabled,
  db = defaultDb,
  retry,
  now = () => new Date(),
}: {
  send: Send;
  creditsEnabled: boolean;
  /** Database for sending and bookkeeping after commit; defaults to the global connection. */
  db?: DatabaseSource;
  /**
   * Fast retries for the immediate post-commit send; defaults to 3 attempts, exponential backoff
   * from 500ms.
   */
  retry?: DeliveryRetry;
  now?: () => Date;
}): OnBillingEventHandler {
  const outbox = createOutbox({ db, send, retry, now });
  return async (event, { tx, userId, stale, afterCommit }) => {
    const spec = billingEmailFor(event, { stale });
    if (!spec) return;

    const [recipient] = await tx
      .select({ email: user.email, locale: user.locale })
      .from(user)
      .where(eq(user.id, userId));
    if (!recipient) return;

    const subscription =
      "subscriptionId" in event && event.subscriptionId
        ? (
            await tx
              .select({
                planId: subscriptions.planId,
                currentPeriodEnd: subscriptions.currentPeriodEnd,
              })
              .from(subscriptions)
              .where(
                and(
                  eq(subscriptions.provider, event.provider),
                  eq(
                    subscriptions.providerSubscriptionId,
                    event.subscriptionId,
                  ),
                ),
              )
          )[0]
        : undefined;

    const locale = preferredLocale(recipient);
    const planId =
      ("planId" in event ? event.planId : undefined) ?? subscription?.planId;
    const plan = planId ? getPlan(planId) : undefined;
    const planName = await planDisplayName(locale, planId);
    const manageUrl = siteLink(locale, "/billing");
    const email = { to: recipient.email, locale };

    const message = ((): Parameters<Send>[0] => {
      switch (spec.template) {
        case "payment-succeeded": {
          const money = moneyOf(event, plan);
          const renewsAt =
            event.type === "subscription.renewed"
              ? (event.currentPeriodEnd ?? subscription?.currentPeriodEnd)
              : undefined;
          return {
            ...email,
            template: "payment-succeeded",
            props: {
              planName: planName ?? siteConfig.name,
              kind:
                event.type === "subscription.renewed"
                  ? "subscription"
                  : "one_time",
              ...money,
              paidAt: event.occurredAt.toISOString(),
              renewsAt: renewsAt?.toISOString(),
              credits: creditsEnabled && plan ? plan.credits : undefined,
              manageUrl,
            },
          };
        }
        case "payment-failed":
          return {
            ...email,
            template: "payment-failed",
            props: { planName, ...moneyOf(event, plan), manageUrl },
          };
        case "subscription-canceled": {
          const endsAt =
            (event.type === "subscription.canceled"
              ? event.currentPeriodEnd
              : undefined) ?? subscription?.currentPeriodEnd;
          return {
            ...email,
            template: "subscription-canceled",
            props: { planName, endsAt: endsAt?.toISOString(), manageUrl },
          };
        }
      }
    })();

    // The slot, outbox row and event handling commit together (and vanish together on rollback);
    // the email is sent only after commit.
    const claimedAt = now();
    const claimed = await claimNotification(tx, {
      kind: spec.template,
      key: spec.key,
      userId,
      windowMs: spec.windowMs,
      now: claimedAt,
    });
    if (!claimed) return;
    const id = await outbox.enqueue(tx, {
      kind: spec.template,
      key: spec.key,
      userId,
      to: recipient.email,
      template: message.template,
      props: message.props as Record<string, unknown>,
      locale,
      claimedAt,
    });
    afterCommit(async () => {
      await outbox.deliver(id);
    });
  };
}

/**
 * Prefer the amount on the event; otherwise use the plan's list price (smallest currency unit) and
 * the site currency.
 */
function moneyOf(
  event: BillingEvent,
  plan: ReturnType<typeof getPlan>,
): { amount?: number; currency?: string } {
  const amount = "amount" in event ? event.amount : undefined;
  const currency = "currency" in event ? event.currency : undefined;
  if (amount !== undefined) {
    return { amount, currency: currency ?? siteConfig.billing.currency };
  }
  if (plan && plan.price > 0) {
    return {
      amount: Math.round(plan.price * 100),
      currency: siteConfig.billing.currency,
    };
  }
  return {};
}
