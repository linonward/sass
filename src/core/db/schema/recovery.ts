import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * 后台任务的租约：一个任务名一行（例如 `recovery`）。
 *
 * 恢复扫描会被好几个来源触发 —— 平台的 cron、自托管的调度器、用户请求顺带的机会式扫描 ——
 * 同一时刻只能有一个在跑，机会式的还要限频。两件事都靠这一行上的原子 UPDATE：
 * `lockedUntil` 未过期表示有人在跑；`lastStartedAt` 用来判断「距上次扫描够不够久」。
 * 进程中途死掉时租约到期自动释放，不需要人工解锁（见 src/core/recovery/lease.ts）。
 */
export const jobLeases = pgTable("job_leases", {
  name: text("name").primaryKey(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull(),
  lastStartedAt: timestamp("last_started_at", { withTimezone: true }).notNull(),
  lastFinishedAt: timestamp("last_finished_at", { withTimezone: true }),
});
