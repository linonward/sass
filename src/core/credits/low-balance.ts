import { eq } from "drizzle-orm";

import { preferredLocale } from "@/core/account/locale";
import { user } from "@/core/db/schema";
import { siteLink } from "@/core/email/links";
import { claimNotification } from "@/core/email/notification-log";
import type { SendEmailOptions } from "@/core/email/send";

import type { LowBalanceHook } from "./service";

const DAY = 24 * 60 * 60 * 1000;

/**
 * 余额跌破阈值时发送 credits-low 邮件，同一用户 24 小时内最多一封。
 * 去重名额在扣减的事务里占用（并发扣减只有一个能拿到），邮件在事务提交后发送；
 * 发送失败只记日志，扣减照常成功。
 */
export function createLowBalanceHook({
  threshold,
  send,
  now = () => new Date(),
}: {
  threshold: number;
  send: (options: SendEmailOptions<"credits-low">) => Promise<unknown>;
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
      const claimed = await claimNotification(executor, {
        kind: "credits-low",
        key: userId,
        userId,
        windowMs: DAY,
        now: now(),
      });
      if (!claimed) return;

      schedule(async () => {
        await send({
          to: recipient.email,
          locale,
          template: "credits-low",
          props: { balance, threshold, topUpUrl: siteLink(locale, "/pricing") },
        });
      });
    },
  };
}
