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

/** 地址先归一化再存：大小写不同的同一个邮箱只能占一行（和 leads 一致）。 */
export const subscriberEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email());

/** 邮件里的确认令牌：32 字节随机数的 base64url。 */
export const subscriberToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** 确认链接的有效期。过期后重新提交一次即可，不需要管理员介入。 */
export const CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;

/** 同一地址重复提交的冷却：这段时间内只发一封确认信。 */
export const RESEND_COOLDOWN_MS = 60 * 1000;

const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export type PreparedSubscription = {
  id: string;
  email: string;
  confirmToken: string;
};

/**
 * 准备一次订阅：写入或刷新待确认的订阅者，返回要发出去的确认令牌。
 *
 * 返回 `null` 表示**不发信**，但调用方对外仍然是同一句「确认邮件已发出」：
 * 冷却期内重复提交、以及已经确认过的地址，都不该让提交者看出这个地址订没订过。
 * 返回的令牌是明文，库里只存哈希。
 */
export async function prepareSubscription(
  db: Database,
  input: { email: string; locale: string },
  now: Date = new Date(),
): Promise<PreparedSubscription | null> {
  const email = subscriberEmail.parse(input.email);

  return db.transaction(async (tx) => {
    // 同一地址的并发提交串行化，否则两封确认信会互相覆盖各自的令牌哈希。
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
      // 未确认的旧行直接换成新令牌；`createdAt` 留在原地，冷却从第一次提交算起。
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
 * 确认订阅。令牌用过之后仍然返回 true：邮件客户端会预取链接，
 * 人再点一次时给「确认失败」是错的。
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
 * 退订链接里的签名：`hmac(email)`，不落库。
 *
 * 通知邮件必须带一条永久有效的退订链接，而库里只有确认令牌的哈希 —— 退订令牌要是也存哈希，
 * 就得为每个订阅者多存一列「当前有效的退订哈希」，还得处理轮换。这里用签名代替：
 * 地址加上站点密钥的 HMAC，谁也伪造不了别人的退订链接，服务端也就不用记任何东西。
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

/** 退订：校验签名后直接删行。状态通知不是要留档的业务数据，退订后没理由继续留着地址。 */
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

/** 后台要看的订阅者列表：已确认的排在前面，其次是最近提交的。 */
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

/** 已确认的订阅者，发通知时逐封发送。 */
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
