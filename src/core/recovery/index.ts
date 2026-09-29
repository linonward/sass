import { aiRecovery } from "@/core/ai";
import { getDb } from "@/core/db";
import { runAfterResponse } from "@/core/lib/after-response";
import { logger } from "@/core/observability/logger";

import { createRecoveryRunner } from "./run";

export { handleCronRecovery } from "./handler";

/**
 * 恢复：把没人推进的后台状态推进到终态（目前是悬着的 AI 任务）。
 *
 * 触发频率由部署方式决定，入口与频率解耦：
 * - 平台 cron / 自托管调度器 → `GET /api/cron/recovery`（带 CRON_SECRET），每次最多处理 20 条；
 * - 机会式：用户用 AI 功能时，响应之后顺带跑一次（距上次不足 5 分钟就跳过），每次最多 3 条。
 * 两条路共用一把数据库租约，不会同时跑。
 */
export const runRecovery = createRecoveryRunner({
  db: getDb,
  tasks: { ai: (options) => aiRecovery(options) },
});

/** cron 入口一次处理的条数：入口的 maxDuration 是 300 秒，一条视频转存通常几秒。 */
export const CRON_RECOVERY_LIMIT = 20;

/** 机会式扫描一次处理的条数：跑在用户请求的 after() 里，占的是那个函数的时长。 */
export const OPPORTUNISTIC_RECOVERY_LIMIT = 3;

/**
 * 同一个实例里 60 秒内只问一次数据库「该不该扫」：视频查询接口每几秒被轮询一次，
 * 不能每次都去抢租约。真正的限频（5 分钟）和互斥在数据库租约里。
 */
const LOCAL_CHECK_INTERVAL_MS = 60 * 1000;
let lastLocalCheck = 0;

/**
 * 在当前请求的响应之后顺带跑一次有界的恢复扫描（到时间才跑）。从不抛错、不拖慢响应。
 * 放在 AI 相关的接口里调用：用户在用 AI 功能，说明站点有流量，也最可能有悬着的任务。
 */
export function scheduleOpportunisticRecovery() {
  const now = Date.now();
  if (now - lastLocalCheck < LOCAL_CHECK_INTERVAL_MS) return;
  lastLocalCheck = now;
  void runAfterResponse(async () => {
    try {
      await runRecovery({
        trigger: "opportunistic",
        limit: OPPORTUNISTIC_RECOVERY_LIMIT,
      });
    } catch (error) {
      logger.error("recovery.opportunistic_failed", { error });
    }
  });
}
