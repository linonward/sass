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

/**
 * The product's name in the recipient's locale (Downloads.products.<id>.name in messages), falling
 * back to the id.
 */
export async function productDisplayName(locale: string, productId: string) {
  const messages: Messages = await loadMessages(locale);
  const products = (messages.Downloads?.products ?? {}) as Record<
    string,
    { name?: string } | undefined
  >;
  return products[productId]?.name ?? productId;
}

/**
 * onBillingEvent hook for selling downloadable files:
 *
 * | BillingEvent                                          | Action                                                        |
 * | -------------------------------------------- | -------------------------------------------- |
 * | checkout.completed (one-time, plan maps to a product) | Record a grant; only a new one sends the "ready" email        |
 * | refund.created (order fully refunded)                 | Revoke this order's grant (partial refunds leave it alone)    |
 *
 * The grant and the email's outbox record are committed in the same transaction as the event;
 * (provider, order, product) is unique, so a replayed or re-sent webhook can't insert again and no
 * second email goes out. The email is sent once right after commit, and if that fails the outbox
 * recovery sweep resends it. Stale events arriving out of order still grant: the money really was
 * received.
 */
export function createDownloadsHandler({
  config,
  db = defaultDb,
  send = sendEmail,
}: {
  config: SiteConfig["downloads"];
  /** Database used for sending and bookkeeping after commit; defaults to the global connection. */
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
