import { eq } from "drizzle-orm";

import { preferredLocale } from "@/core/account/locale";
import { db as defaultDb } from "@/core/db";
import { user } from "@/core/db/schema";
import {
  createNotificationDelivery,
  type DatabaseSource,
  type DeliveryRetry,
} from "@/core/email/delivery";
import { siteLink } from "@/core/email/links";
import { claimNotification } from "@/core/email/notification-log";
import type { SendEmailOptions } from "@/core/email/send";

import type { LowBalanceHook } from "./service";

const DAY = 24 * 60 * 60 * 1000;

/**
 * 余额跌破阈值时发送 credits-low 邮件，同一用户 24 小时内最多一封。
 * 去重名额在扣减的事务里占用（并发扣减只有一个能拿到），邮件在事务提交后发送；
 * 发送失败只记日志（并重试、最终失败时释放名额），扣减照常成功。
 *
 * 「24 小时内最多一封」按**发成功**的那次算：发送失败的那次会释放名额，之后再次跨过
 * 阈值时还会提醒 —— 用户不会因为一次发信失败就收不到提醒。
 * `db` 只用于释放名额（扣减的事务此时已经提交，hook 拿到的 executor 可能是调用方的 tx）。
 */
export function createLowBalanceHook({
  threshold,
  send,
  db = defaultDb,
  retry,
  now = () => new Date(),
}: {
  threshold: number;
  send: (options: SendEmailOptions<"credits-low">) => Promise<unknown>;
  /** 释放名额用的数据库；默认全局连接。 */
  db?: DatabaseSource;
  /** 发送失败的重试参数；默认 3 次、500ms 起指数退避。 */
  retry?: DeliveryRetry;
  now?: () => Date;
}): LowBalanceHook {
  return {
    threshold,
    async onCross({ executor, userId, balance, schedule }) {
      const [recipient] = await executor
        .select({ email: user.email, locale: user.locale })
        .from(user)
        .where(eq(user.id, userId));
      if (!recipient) return;

      const locale = preferredLocale(recipient);
      const claimedAt = now();
      const claimed = await claimNotification(executor, {
        kind: "credits-low",
        key: userId,
        userId,
        windowMs: DAY,
        now: claimedAt,
      });
      if (!claimed) return;

      schedule(
        createNotificationDelivery({
          db,
          kind: "credits-low",
          key: userId,
          now: claimedAt,
          send: () =>
            send({
              to: recipient.email,
              locale,
              template: "credits-low",
              props: {
                balance,
                threshold,
                topUpUrl: siteLink(locale, "/pricing"),
              },
            }),
          retry,
        }),
      );
    },
  };
}
