import { z } from "zod";

/**
 * 恢复入口（`/api/cron/recovery`）的变量。
 * - `CRON_SECRET`：调用方必须带 `Authorization: Bearer <CRON_SECRET>`。Vercel 的 cron 会自动
 *   带上这个头；自托管的调度器 curl 时自己带。不设时入口一律 404 —— 明确拒绝，不静默放行。
 *   不设也不影响站点运行：恢复扫描仍会在用户使用 AI 功能时机会式地跑（见 ./index.ts）。
 */
export function recoveryServerEnv() {
  return {
    CRON_SECRET: z
      .string()
      .min(16, "must be at least 16 characters (openssl rand -hex 32)")
      .optional(),
  };
}
