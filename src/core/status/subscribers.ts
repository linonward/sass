import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { desc, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/core/db/client";
import { statusSubscribers } from "@/core/db/schema/status";
import { env } from "@/core/env";

/**
 * Addresses are normalized before storing: the same email in different letter case gets only one
 * row (consistent with leads).
 */
export const subscriberEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email());

/** Confirmation token in the email: 32 random bytes, base64url-encoded. */
export const subscriberToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** Lifetime of the confirmation link. After expiry, submitting again is enough; no admin needed. */
export const CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;

/** Cooldown for repeat submissions from one address: one confirmation email per window. */
export const RESEND_COOLDOWN_MS = 60 * 1000;

const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export type PreparedSubscription = {
  id: string;
  email: string;
  confirmToken: string;
};

/**
 * Prepares a subscription: inserts or refreshes the pending subscriber and returns the
 * confirmation token to send.
 *
 * Returning `null` means **don't send**, but the caller still shows the same "confirmation email
 * sent" message: neither a repeat submission during the cooldown nor an already-confirmed address
 * should let the submitter tell whether the address is subscribed.
 * The returned token is plaintext; only its hash is stored.
 */
export async function prepareSubscription(
  db: Database,
  input: { email: string; locale: string },
  now: Date = new Date(),
): Promise<PreparedSubscription | null> {
  const email = subscriberEmail.parse(input.email);

  return db.transaction(async (tx) => {
    // Serialize concurrent submissions for the same address; otherwise two confirmation emails
    // would overwrite each other's token hash.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`status:${email}`}))`,
    );
    const [existing] = await tx
      .select()
      .from(statusSubscribers)
      .where(eq(statusSubscribers.email, email))
      .for("update");

    if (existing?.confirmedAt) return null;
    if (
      existing &&
      now.getTime() - existing.createdAt.getTime() < RESEND_COOLDOWN_MS
    ) {
      return null;
    }

    const confirmToken = randomBytes(32).toString("base64url");
    const issued = {
      locale: input.locale,
      confirmHash: tokenHash(confirmToken),
      confirmExpiresAt: new Date(now.getTime() + CONFIRM_TTL_MS),
    };

    if (existing) {
      // An unconfirmed old row just gets a new token; `createdAt` stays put, so the cooldown counts
      // from the first submission.
      await tx
        .update(statusSubscribers)
        .set(issued)
        .where(eq(statusSubscribers.id, existing.id));
      return { id: existing.id, email, confirmToken };
    }

    const id = randomUUID();
    await tx.insert(statusSubscribers).values({
      id,
      email,
      createdAt: now,
      ...issued,
    });
    return { id, email, confirmToken };
  });
}

/**
 * Confirms a subscription. Still returns true once the token has been used: email clients prefetch
 * links, and showing "confirmation failed" when the person then clicks would be wrong.
 */
export async function confirmSubscription(
  db: Database,
  token: string,
  now: Date = new Date(),
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(statusSubscribers)
      .where(eq(statusSubscribers.confirmHash, tokenHash(token)))
      .for("update");
    if (!row) return false;
    if (row.confirmedAt) return true;
    if (!row.confirmExpiresAt || row.confirmExpiresAt <= now) return false;

    await tx
      .update(statusSubscribers)
      .set({ confirmedAt: now })
      .where(eq(statusSubscribers.id, row.id));
    return true;
  });
}

/**
 * Signature in the unsubscribe link: `hmac(email)`, never stored.
 *
 * Notification emails must carry an unsubscribe link that stays valid forever, but the database
 * only holds the hash of the confirmation token — storing a hash for unsubscribe tokens too would
 * mean an extra "currently valid unsubscribe hash" column per subscriber, plus handling rotation.
 * A signature replaces all that: an HMAC of the address with the site secret, so nobody can forge
 * someone else's unsubscribe link and the server doesn't have to remember anything.
 */
export function withdrawSignature(
  email: string,
  secret: string = env.BETTER_AUTH_SECRET,
): string {
  return createHmac("sha256", secret)
    .update(`status-withdraw:${subscriberEmail.parse(email)}`)
    .digest("base64url");
}

export function verifyWithdrawSignature(
  email: string,
  signature: string,
  secret: string = env.BETTER_AUTH_SECRET,
): boolean {
  let expected: string;
  try {
    expected = withdrawSignature(email, secret);
  } catch {
    return false;
  }
  return (
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  );
}

/**
 * Unsubscribes: verifies the signature, then deletes the row. Status notifications aren't business
 * records worth archiving, so there's no reason to keep the address after unsubscribing.
 */
export async function withdrawSubscription(
  db: Database,
  input: { email: string; signature: string },
): Promise<boolean> {
  if (!verifyWithdrawSignature(input.email, input.signature)) return false;
  const rows = await db
    .delete(statusSubscribers)
    .where(eq(statusSubscribers.email, subscriberEmail.parse(input.email)))
    .returning({ id: statusSubscribers.id });
  return rows.length > 0;
}

export type SubscriberRow = {
  email: string;
  locale: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
};

/** Subscriber list for the admin: confirmed first, then most recently submitted. */
export async function listSubscribers(
  db: Database,
  limit = 100,
): Promise<SubscriberRow[]> {
  return db
    .select({
      email: statusSubscribers.email,
      locale: statusSubscribers.locale,
      confirmedAt: statusSubscribers.confirmedAt,
      createdAt: statusSubscribers.createdAt,
    })
    .from(statusSubscribers)
    .orderBy(
      desc(isNotNull(statusSubscribers.confirmedAt)),
      desc(statusSubscribers.createdAt),
    )
    .limit(limit);
}

/** Confirmed subscribers; notifications are sent to them one email at a time. */
export async function listConfirmedSubscribers(
  db: Database,
): Promise<{ email: string; locale: string | null }[]> {
  return db
    .select({
      email: statusSubscribers.email,
      locale: statusSubscribers.locale,
    })
    .from(statusSubscribers)
    .where(isNotNull(statusSubscribers.confirmedAt));
}
