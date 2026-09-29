import { eq } from "drizzle-orm";

import { preferredLocale } from "@/core/account/locale";
import { db as defaultDb } from "@/core/db";
import { user } from "@/core/db/schema";
import {
  createOutbox,
  type DatabaseSource,
  type DeliveryRetry,
} from "@/core/email/outbox";
import { siteLink } from "@/core/email/links";
import { claimNotification } from "@/core/email/notification-log";
import type { SendEmailOptions } from "@/core/email/send";
import type { SendOptions } from "@/core/email/transports";

import type { LowBalanceHook } from "./service";

const DAY = 24 * 60 * 60 * 1000;

/**
 * 余额跌破阈值时发送 credits-low 邮件，同一用户 24 小时内最多一封。
 * 去重名额在扣减的事务里占用（并发扣减只有一个能拿到），邮件在事务提交后发送；
 * 邮件和名额一起写进 outbox，提交后立即发一次；发不出去由恢复扫描补发，扣减照常成功。
 *
 * 「24 小时内最多一封」按**发成功**的那次算：重试用完仍没发出的那次会释放名额，之后再次
 * 跨过阈值时还会提醒 —— 用户不会因为一次发信故障就收不到提醒。
 * `db` 用于提交后的发送与记账（扣减的事务此时已经提交，hook 拿到的 executor 可能是调用方的 tx）。
 */
export function createLowBalanceHook({
  threshold,
  send,
  db = defaultDb,
  retry,
  now = () => new Date(),
}: {
  threshold: number;
  send: (
    options: SendEmailOptions<"credits-low">,
    sendOptions?: SendOptions,
  ) => Promise<unknown>;
  /** 提交后发送与记账用的数据库；默认全局连接。 */
  db?: DatabaseSource;
  /** 提交后立即发送时的快速重试；默认 3 次、500ms 起指数退避。 */
  retry?: DeliveryRetry;
  now?: () => Date;
}): LowBalanceHook {
  const outbox = createOutbox({
    db,
    // outbox 按模板名存取，这个 hook 只会写 credits-low。
    send: (options, sendOptions) =>
      send(options as SendEmailOptions<"credits-low">, sendOptions),
    retry,
    now,
  });
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

      const id = await outbox.enqueue(executor, {
        kind: "credits-low",
        key: userId,
        userId,
        to: recipient.email,
        template: "credits-low",
        props: { balance, threshold, topUpUrl: siteLink(locale, "/pricing") },
        locale,
        claimedAt,
      });
      schedule(async () => {
        await outbox.deliver(id);
      });
    },
  };
}
