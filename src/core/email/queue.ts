import { getDb } from "@/core/db";
import { env } from "@/core/env";

import { createOutbox } from "./outbox";
import { sendEmail } from "./send";

/**
 * 绑定全局数据库、真实发送和 BETTER_AUTH_SECRET（加密验证码）的 outbox。
 * 验证码邮件与恢复扫描用它；账单邮件 / 余额提醒在各自的 hook 里按同样的方式组装。
 */
export const notificationOutbox = createOutbox({
  // 延迟取连接：只在真正发信时才需要数据库（测试里 mock 掉 @/core/db 时也不会在加载时就炸）。
  db: () => getDb(),
  send: sendEmail,
  secret: env.BETTER_AUTH_SECRET,
});
