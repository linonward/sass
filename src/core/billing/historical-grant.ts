import { and, eq, sql } from "drizzle-orm";
import type { DbTransaction } from "@/core/db";
import { webhookEvents } from "@/core/db/schema";
import { billingGrantSourceId } from "./grant-credits";
import { parseCreemEvent } from "./providers/creem";

/** Older Creem orders have no ledger pointer. Recover the exact period from the
 * already-verified payment event, never the subscription's current period/config.
 * Other providers without an order-key grant need their own historical adapter.
 */
export async function historicalGrantSourceId(
  tx: DbTransaction,
  provider: string,
  orderId: string,
) {
  if (provider !== "creem") return null;
  const rows = await tx
    .select({ raw: webhookEvents.raw })
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.provider, provider),
        eq(webhookEvents.type, "subscription.renewed"),
        sql`${webhookEvents.raw}->'object'->>'last_transaction_id' = ${orderId}`,
      ),
    );
  const keys = new Set(
    rows.flatMap((row) => {
      const event = parseCreemEvent(row.raw);
      const key =
        event?.type === "subscription.renewed" && event.orderId === orderId
          ? billingGrantSourceId(event)
          : null;
      return key ? [key] : [];
    }),
  );
  // Conflicting historical identities cannot safely select a grant.
  return keys.size === 1 ? [...keys][0]! : null;
}
