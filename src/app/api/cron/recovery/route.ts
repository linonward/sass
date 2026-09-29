import { env } from "@/core/env";
import {
  CRON_RECOVERY_LIMIT,
  handleCronRecovery,
  runRecovery,
} from "@/core/recovery";

// 一次最多推进 CRON_RECOVERY_LIMIT 条任务，视频要下载转存；Vercel 上函数最长运行时间（秒）。
export const maxDuration = 300;

/**
 * 恢复入口：Vercel cron（vercel.json 的 crons）或任何调度器按 `Authorization: Bearer $CRON_SECRET`
 * 调用。没设 CRON_SECRET 时返回 404。
 */
export async function GET(request: Request) {
  return handleCronRecovery(request, {
    secret: env.CRON_SECRET,
    run: () => runRecovery({ trigger: "cron", limit: CRON_RECOVERY_LIMIT }),
  });
}
