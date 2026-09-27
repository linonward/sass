import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { Database, DbTransaction } from "@/core/db";
import { leads, userAttribution } from "@/core/db/schema";
import { isCurrent, type Attribution } from "../context";
import { DAY, emailInput } from "./input";
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const cleared = {
  email: null,
  status: "withdrawn" as const,
  consentVersion: null,
  consentText: null,
  consentAt: null,
  snapshot: null,
  confirmedAt: null,
  confirmHash: null,
  confirmExpiresAt: null,
  withdrawHash: null,
  sentAt: null,
  userId: null,
  linkedAt: null,
};
async function scrub(tx: DbTransaction, id: string) {
  await tx
    .update(userAttribution)
    .set({ snapshot: null, leadId: null, withdrawnAt: new Date() })
    .where(eq(userAttribution.leadId, id));
  await tx.update(leads).set(cleared).where(eq(leads.id, id));
}
export function createLeadService(db: Database) {
  return {
    async prepare(
      input: {
        email: string;
        listId: string;
        consentVersion: string;
        consentText: string;
        snapshot: Attribution | null;
      },
      now = new Date(),
    ) {
      const email = emailInput.parse(input.email);
      return db.transaction(async (tx) => {
        // Serialize submit/resend for this list and address, including first insert.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`lead:${input.listId}:${email}`}))`,
        );
        let [lead] = await tx
          .select()
          .from(leads)
          .where(and(eq(leads.email, email), eq(leads.listId, input.listId)))
          .for("update");
        if (lead && lead.expiresAt <= now) {
          await scrub(tx, lead.id);
          lead = undefined;
        }
        if (lead?.sentAt && now.getTime() - lead.sentAt.getTime() < 60_000)
          return null;
        const confirmToken = randomBytes(32).toString("base64url");
        const withdrawToken = randomBytes(32).toString("base64url");
        const issued = {
          confirmHash: tokenHash(confirmToken),
          withdrawHash: tokenHash(withdrawToken),
          confirmExpiresAt: new Date(now.getTime() + DAY),
          sentAt: now,
        };
        const id = lead?.id ?? randomUUID();
        if (lead) {
          // Resends never change consent, source, confirmation or retention clocks.
          await tx.update(leads).set(issued).where(eq(leads.id, id));
        } else {
          await tx.insert(leads).values({
            id,
            listId: input.listId,
            email,
            consentVersion: input.consentVersion,
            consentText: input.consentText,
            consentAt: now,
            snapshot: input.snapshot,
            createdAt: now,
            expiresAt: new Date(now.getTime() + 7 * DAY),
            ...issued,
          });
        }
        return { id, email, confirmToken, withdrawToken };
      });
    },
    async releaseSend(id: string, confirmToken: string) {
      // A failed older send must not release a newer send's cooldown.
      await db
        .update(leads)
        .set({ sentAt: null })
        .where(
          and(eq(leads.id, id), eq(leads.confirmHash, tokenHash(confirmToken))),
        );
    },
    async confirm(token: string, now = new Date()) {
      return db.transaction(async (tx) => {
        const [lead] = await tx
          .select()
          .from(leads)
          .where(eq(leads.confirmHash, tokenHash(token)))
          .for("update");
        if (!lead || lead.status === "withdrawn" || lead.expiresAt <= now)
          return false;
        if (lead.status === "confirmed") return true; // consumed token: no additional write
        if (!lead.confirmExpiresAt || lead.confirmExpiresAt <= now)
          return false;
        await tx
          .update(leads)
          .set({
            status: "confirmed",
            confirmedAt: now,
            expiresAt: new Date(now.getTime() + 180 * DAY),
          })
          .where(eq(leads.id, lead.id));
        return true;
      });
    },
    async withdraw(token: string) {
      await db.transaction(async (tx) => {
        const [lead] = await tx
          .select()
          .from(leads)
          .where(eq(leads.withdrawHash, tokenHash(token)))
          .for("update");
        if (lead) await scrub(tx, lead.id);
      });
    },
    async withdrawEmail(email: string) {
      await db.transaction(async (tx) => {
        const rows = await tx
          .select({ id: leads.id })
          .from(leads)
          .where(eq(leads.email, emailInput.parse(email)))
          .orderBy(asc(leads.id))
          .for("update");
        for (const row of rows) await scrub(tx, row.id);
      });
    },
    async linkRegistration(
      account: {
        id: string;
        email: string;
        emailVerified: boolean;
        createdAt: Date;
      },
      inheritSource: boolean,
      now = new Date(),
    ) {
      if (!account.emailVerified) return;
      await db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(leads)
          .where(
            and(
              eq(leads.email, emailInput.parse(account.email)),
              eq(leads.status, "confirmed"),
              gt(leads.expiresAt, account.createdAt),
              gt(leads.expiresAt, now),
            ),
          )
          .orderBy(asc(leads.createdAt), asc(leads.id))
          .for("update");
        for (const lead of rows) {
          // Only confirmations that existed when this account registered qualify.
          if (
            lead.userId ||
            !lead.confirmedAt ||
            lead.confirmedAt > account.createdAt
          )
            continue;
          await tx
            .update(leads)
            .set({ userId: account.id, linkedAt: account.createdAt })
            .where(eq(leads.id, lead.id));
          if (
            inheritSource &&
            lead.snapshot &&
            isCurrent(lead.snapshot, account.createdAt.getTime())
          ) {
            await tx
              .insert(userAttribution)
              .values({
                userId: account.id,
                snapshot: lead.snapshot,
                registeredAt: account.createdAt,
                leadId: lead.id,
              })
              .onConflictDoNothing();
          }
        }
      });
    },
  };
}
