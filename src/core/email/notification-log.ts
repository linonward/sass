import { lte } from "drizzle-orm";

import type { Database, DbTransaction } from "@/core/db/client";
import { notificationLog } from "@/core/db/schema";

type Executor = Database | DbTransaction;

/**
 * 占用一次通知的发送名额：返回 true 表示这次应该发送，false 表示窗口内已发过。
 * - windowMs 为 null：同一 (kind, key) 只发一次；
 * - 否则距上次发送超过 windowMs 才会再次返回 true。
 * 用一条 upsert 判断，并发调用时只有一个能拿到名额。和业务写入放在同一个事务里，
 * 事务回滚时名额也一起回滚；邮件在事务提交后再发。
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
