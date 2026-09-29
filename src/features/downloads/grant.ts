import { and, eq, isNull } from "drizzle-orm";
import type { Messages } from "next-intl";

import { preferredLocale } from "@/core/account/locale";
import type { OnBillingEventHandler } from "@/core/billing/on-billing-event";
import { db as defaultDb } from "@/core/db";
import { orders, user } from "@/core/db/schema";
import type { SiteConfig } from "@/core/config/schema";
import { createOutbox, type DatabaseSource } from "@/core/email/outbox";
import { siteLink } from "@/core/email/links";
import { sendEmail } from "@/core/email/send";
import { loadMessages } from "@/core/email/translator";

import { productForPlan, updatesUntil } from "./access";
import { downloadEntitlements } from "./schema";

/** 产品在收件人语言里的名称（messages 的 Downloads.products.<id>.name），缺失时用 id。 */
export async function productDisplayName(locale: string, productId: string) {
  const messages: Messages = await loadMessages(locale);
  const products = (messages.Downloads?.products ?? {}) as Record<
    string,
    { name?: string } | undefined
  >;
  return products[productId]?.name ?? productId;
}

/**
 * 卖可下载文件的 onBillingEvent 钩子：
 *
 * | BillingEvent                                 | 动作                                         |
 * | -------------------------------------------- | -------------------------------------------- |
 * | checkout.completed（一次性、套餐对应某产品） | 记一条授权；新记的才发「可以下载了」邮件     |
 * | refund.created（订单已全额退款）             | 收回这笔订单的授权（部分退款不动）           |
 *
 * 授权和邮件的 outbox 记录与事件在同一个事务里提交；(provider, 订单, 产品) 唯一，
 * webhook 重放或补发时插不进去，也就不会再发一封。邮件在提交后立即发一次，
 * 没发出去由 outbox 的恢复扫描补发。乱序到达的旧事件（stale）照样授权：钱确实收到了。
 */
export function createDownloadsHandler({
  config,
  db = defaultDb,
  send = sendEmail,
}: {
  config: SiteConfig["downloads"];
  /** 提交后发送与记账用的数据库；默认全局连接。 */
  db?: DatabaseSource;
  send?: Parameters<typeof createOutbox>[0]["send"];
}): OnBillingEventHandler {
  const outbox = createOutbox({ db, send });
  return async (event, { tx, userId, afterCommit }) => {
    if (!config.enabled) return;

    if (event.type === "refund.created") {
      const [order] = await tx
        .select({ status: orders.status })
        .from(orders)
        .where(
          and(
            eq(orders.provider, event.provider),
            eq(orders.providerOrderId, event.orderId),
          ),
        );
      if (order?.status !== "refunded") return;
      await tx
        .update(downloadEntitlements)
        .set({ revokedAt: event.occurredAt })
        .where(
          and(
            eq(downloadEntitlements.provider, event.provider),
            eq(downloadEntitlements.orderId, event.orderId),
            isNull(downloadEntitlements.revokedAt),
          ),
        );
      return;
    }

    if (event.type !== "checkout.completed") return;
    if (event.subscriptionId || !event.orderId) return;
    const product = productForPlan(config, event.planId);
    if (!product) return;

    const until = updatesUntil(event.occurredAt, product.updateMonths);
    const [granted] = await tx
      .insert(downloadEntitlements)
      .values({
        userId,
        productId: product.id,
        provider: event.provider,
        orderId: event.orderId,
        purchasedAt: event.occurredAt,
        updatesUntil: until,
      })
      .onConflictDoNothing()
      .returning({ id: downloadEntitlements.id });
    if (!granted) return;

    const [recipient] = await tx
      .select({ email: user.email, locale: user.locale })
      .from(user)
      .where(eq(user.id, userId));
    if (!recipient) return;

    const locale = preferredLocale(recipient);
    const id = await outbox.enqueue(tx, {
      kind: "download-ready",
      key: `${event.provider}:${event.orderId}:${product.id}`,
      userId,
      to: recipient.email,
      template: "download-ready",
      props: {
        productName: await productDisplayName(locale, product.id),
        downloadsUrl: siteLink(locale, "/downloads"),
        updatesUntil: until.toISOString(),
      },
      locale,
    });
    afterCommit(async () => {
      await outbox.deliver(id);
    });
  };
}
