import { and, eq, lte } from "drizzle-orm";

import type { Database, DbTransaction } from "@/core/db/client";
import { notificationLog } from "@/core/db/schema";

type Executor = Database | DbTransaction;

/**
 * 占用一次通知的发送名额：返回 true 表示这次应该发送，false 表示窗口内已发过。
 * - windowMs 为 null：同一 (kind, key) 只发一次；
 * - 否则距上次发送超过 windowMs 才会再次返回 true。
 * 用一条 upsert 判断，并发调用时只有一个能拿到名额。和业务写入放在同一个事务里，
 * 事务回滚时名额也一起回滚；邮件在事务提交后再发。
 *
 * 占名额只表示「这次由我来发」，发送失败时用 releaseNotificationClaim 还回名额
 * （见 `./delivery.ts`）：否则一次失败的发送会永久占住 (kind, key)，邮件再也发不出去。
 */
export async function claimNotification(
  executor: Executor,
  {
    kind,
    key,
    userId,
    windowMs,
    now = new Date(),
  }: {
    kind: string;
    key: string;
    userId: string;
    windowMs: number | null;
    now?: Date;
  },
): Promise<boolean> {
  const insert = executor
    .insert(notificationLog)
    .values({ kind, key, userId, lastSentAt: now });
  const rows =
    windowMs === null
      ? await insert
          .onConflictDoNothing({
            target: [notificationLog.kind, notificationLog.key],
          })
          .returning({ kind: notificationLog.kind })
      : await insert
          .onConflictDoUpdate({
            target: [notificationLog.kind, notificationLog.key],
            set: { lastSentAt: now, userId },
            // 用 lte 让参数走列自己的编码（和写入时一致），避免 Date 按本机时区序列化后比较错位。
            setWhere: lte(
              notificationLog.lastSentAt,
              new Date(now.getTime() - windowMs),
            ),
          })
          .returning({ kind: notificationLog.kind });
  return rows.length > 0;
}

/**
 * 释放一次通知的发送名额：邮件最终发送失败时调用，让之后同 key 的尝试（服务商重放、
 * 人工补发、下一个窗口）能重新占用名额，把这封邮件真的发出去。
 *
 * `now` 必须是占名额时传给 claimNotification 的那个时间：只删除**仍然是这次尝试**的行。
 * 如果发送期间已经有别的路径重新占了名额（窗口过期后又发送成功），那行的 last_sent_at
 * 是新的时间，这里匹配不到，删不掉 —— 避免把别人的名额误删成重复轰炸。
 * 返回是否真的释放了名额（false 表示这行已经被更新的发送接管，或本来就不在了）。
 *
 * 语义上的取舍：失败的那次不算「已发送」，所以窗口（windowMs）从下一次成功发送重新起算。
 * 已送达的邮件仍然受窗口约束（同一窗口内不会重复发），失败的邮件则可以重试。
 */
export async function releaseNotificationClaim(
  executor: Executor,
  { kind, key, now }: { kind: string; key: string; now: Date },
): Promise<boolean> {
  const rows = await executor
    .delete(notificationLog)
    .where(
      and(
        eq(notificationLog.kind, kind),
        eq(notificationLog.key, key),
        // 走列自己的编码（和写入时一致），避免 Date 按本机时区序列化后比较错位。
        eq(notificationLog.lastSentAt, now),
      ),
    )
    .returning({ kind: notificationLog.kind });
  return rows.length > 0;
}
