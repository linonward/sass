import { and, eq } from "drizzle-orm";

import { preferredLocale } from "@/core/account/locale";
import { db as defaultDb } from "@/core/db";
import { subscriptions, user } from "@/core/db/schema";
import {
  createNotificationDelivery,
  type DatabaseSource,
  type DeliveryRetry,
} from "@/core/email/delivery";
import { siteLink } from "@/core/email/links";
import { claimNotification } from "@/core/email/notification-log";
import { planDisplayName } from "@/core/email/plan-name";
import type { SendEmailOptions } from "@/core/email/send";
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
  /** 去重键：同一笔付款、同一个订阅的取消只通知一次。 */
  key: string;
  /** null 表示只发一次；否则窗口内最多一次。 */
  windowMs: number | null;
};

const DAY = 24 * 60 * 60 * 1000;

/**
 * 账单事件 → 邮件：
 *
 * | BillingEvent                               | 邮件                   | 去重                         |
 * | ------------------------------------------ | ---------------------- | ---------------------------- |
 * | checkout.completed（一次性购买，带订单）   | payment-succeeded      | 订单，只发一次               |
 * | checkout.completed（订阅结账）             | 不发                   | 由 subscription.renewed 负责 |
 * | subscription.renewed（含首期）             | payment-succeeded      | 订阅 + 账期，只发一次        |
 * | payment.failed                             | payment-failed         | 订阅或订单，24 小时一次      |
 * | subscription.canceled                      | subscription-canceled  | 订阅，只发一次               |
 * | subscription.active / expired、refund      | 不发                   |                              |
 *
 * 乱序到达的旧事件（stale）：付款成功照发（钱确实收到了）；付款失败和取消已被更新的状态
 * 覆盖（例如之后又续费成功、重新激活），不再打扰用户。
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
) => Promise<unknown>;

/**
 * 发送账单邮件的 onBillingEvent 钩子。
 * 在事件的事务里读取收件人、占用去重名额；邮件本身用 afterCommit 在事务提交后发送，
 * 所以事务回滚（Creem 会重试）时不会发出邮件，重复投递也因 webhook_events 幂等不会再触发。
 *
 * 提交后的发送失败会重试，最终失败则释放名额（见 `@/core/email/delivery`）：付款成功这类
 * 关键邮件不会因为一次失败就永远发不出去。`db` 只用于释放名额（事务已经提交，不能再用它）。
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
  /** 释放名额用的数据库；默认全局连接。 */
  db?: DatabaseSource;
  /** 发送失败的重试参数；默认 3 次、500ms 起指数退避。 */
  retry?: DeliveryRetry;
  now?: () => Date;
}): OnBillingEventHandler {
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

    // 名额和事件处理一起提交；邮件在提交之后才发，失败会重试、最终失败则释放名额。
    const claimedAt = now();
    const claimed = await claimNotification(tx, {
      kind: spec.template,
      key: spec.key,
      userId,
      windowMs: spec.windowMs,
      now: claimedAt,
    });
    if (!claimed) return;
    afterCommit(
      createNotificationDelivery({
        db,
        kind: spec.template,
        key: spec.key,
        now: claimedAt,
        send: () => send(message),
        retry,
      }),
    );
  };
}

/** 事件带的金额优先；没有时用套餐标价（最小货币单位）和站点币种。 */
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
