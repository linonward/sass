import type { Database } from "@/core/db/client";
import { sendEmail } from "@/core/email";
import { siteLink } from "@/core/email/links";
import { routing } from "@/core/i18n/routing";
import { logger } from "@/core/observability/logger";

import siteConfig from "../../../site.config";
import { componentLabel, shouldNotify, type StatusEvent } from "./status";
import { markNotified } from "./store";
import { listConfirmedSubscribers, withdrawSignature } from "./subscribers";

/** 通知邮件里指向状态页的地址；组件名用配置里的展示名（组件被删掉时回退成 key）。 */
function incidentProps(event: StatusEvent, locale: string, email: string) {
  return {
    component: componentLabel(
      siteConfig.statusPage.components,
      event.component,
    ),
    status: event.status,
    message: event.message,
    resolvedAt: event.resolvedAt?.toISOString() ?? null,
    url: siteLink(locale, "/status"),
    withdrawUrl: siteLink(
      locale,
      `/status/unsubscribe?email=${encodeURIComponent(email)}&signature=${withdrawSignature(email)}`,
    ),
  };
}

/**
 * 把一次 incident 变更广播给已确认的订阅者，返回实际发出的封数。
 *
 * 合并窗口落在 incident 行的 `notifiedAt`（见 `status.ts` 的 `shouldNotify`）：5 分钟内的
 * 创建 / 更新 / 解决只发一封，否则一次故障期间订阅者会被十几封邮件追着打。
 *
 * v1 逐封发送，没有接 Resend 的 audience / broadcast —— 订阅者量级是「有几个算几个」，
 * 换广播要先把地址同步到 Resend，那是另一个模块的事。发信失败只记日志：一条地址收不到
 * 不能拖住其余的，管理员那次操作也已经成功了。
 */
export async function notifySubscribers(
  db: Database,
  event: StatusEvent,
  now: Date = new Date(),
): Promise<number> {
  if (!shouldNotify(event, now)) return 0;

  const subscribers = await listConfirmedSubscribers(db);
  // 没有订阅者也要记这一笔：窗口的语义是「这次事件在这个时刻广播过」。
  await markNotified(db, event.id, now);

  let sent = 0;
  for (const subscriber of subscribers) {
    const locale = subscriber.locale ?? routing.defaultLocale;
    try {
      await sendEmail({
        to: subscriber.email,
        template: "status-incident",
        props: incidentProps(event, locale, subscriber.email),
        locale,
      });
      sent += 1;
    } catch (error) {
      logger.error("status.notify_failed", {
        error,
        template: "status-incident",
      });
    }
  }
  return sent;
}
