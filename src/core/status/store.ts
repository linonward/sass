import { and, desc, eq, gte, isNull, or } from "drizzle-orm";

import type { StatusPageConfig, StatusComponent } from "@/core/config/schema";
import type { Database } from "@/core/db/client";
import {
  statusEvents,
  type StatusEventSource,
  type StatusEventStatus,
} from "@/core/db/schema/status";

import {
  getComponentStatus,
  getUptime,
  overallStatus,
  type ComponentStatus,
  type OverallStatus,
  type StatusEvent,
} from "./status";

/** 时间线上的 incident 上限；窗口之外的旧记录不进首屏。 */
const INCIDENT_LIMIT = 50;

export type StatusBoardComponent = {
  key: string;
  label: string;
  description?: string;
  status: ComponentStatus;
  /** 窗口内的 uptime 百分比。 */
  uptime: number;
};

export type StatusBoard = {
  overall: OverallStatus;
  components: StatusBoardComponent[];
  /** 窗口内的 incident，按时间倒序。 */
  incidents: StatusEvent[];
};

/** 和窗口有交集的 incident：窗口内开始的、窗口内才结束的，以及还在进行中的。 */
function inWindow(since: Date) {
  return or(
    gte(statusEvents.createdAt, since),
    gte(statusEvents.resolvedAt, since),
    isNull(statusEvents.resolvedAt),
  );
}

/** 窗口内的全部 incident，以及仍在进行中的那几条（后者不受窗口和条数上限影响）。 */
async function collectEvents(db: Database, since: Date) {
  const [open, recent] = await Promise.all([
    db.select().from(statusEvents).where(isNull(statusEvents.resolvedAt)),
    db
      .select()
      .from(statusEvents)
      .where(inWindow(since))
      .orderBy(desc(statusEvents.createdAt))
      .limit(INCIDENT_LIMIT),
  ]);
  return { open, recent };
}

/** 状态页首屏需要的全部数据：整体状态、每个组件的当前状态和 uptime、近期 incident。 */
export async function getStatusBoard(
  db: Database,
  config: StatusPageConfig,
  now: Date = new Date(),
): Promise<StatusBoard> {
  const since = new Date(now.getTime() - config.historyDays * 86_400_000);
  const { open, recent } = await collectEvents(db, since);
  const events: StatusEvent[] = recent;

  const components = Object.entries(config.components).map(
    ([key, component]: [string, StatusComponent]) => ({
      key,
      label: component.label,
      description: component.description,
      status: getComponentStatus(
        open.filter((event) => event.component === key),
      ),
      uptime: getUptime(
        events.filter((event) => event.component === key),
        { now, days: config.historyDays },
      ),
    }),
  );

  return {
    overall: overallStatus(components.map((c) => c.status.status)),
    components,
    incidents: events,
  };
}

/** 取某个组件的当前状态（不进窗口过滤：进行中的 incident 永远算数）。 */
export async function getComponentStatusFromDb(
  db: Database,
  component: string,
): Promise<ComponentStatus> {
  const open = await db
    .select()
    .from(statusEvents)
    .where(
      and(
        eq(statusEvents.component, component),
        isNull(statusEvents.resolvedAt),
      ),
    )
    .orderBy(desc(statusEvents.createdAt));
  return getComponentStatus(open);
}

/** 最近 N 天的 uptime 百分比。 */
export async function getUptimeFromDb(
  db: Database,
  component: string,
  days: number,
  now: Date = new Date(),
): Promise<number> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const events = await db
    .select()
    .from(statusEvents)
    .where(and(eq(statusEvents.component, component), inWindow(since)));
  return getUptime(events, { now, days });
}

export type IncidentInput = {
  component: string;
  status: StatusEventStatus;
  message: string;
};

export async function createIncident(
  db: Database,
  input: IncidentInput & { source?: StatusEventSource },
): Promise<StatusEvent> {
  const [row] = await db
    .insert(statusEvents)
    .values({
      component: input.component,
      status: input.status,
      message: input.message,
      source: input.source ?? "manual",
    })
    .returning();
  return row!;
}

/** 更新进行中的 incident：改影响级别或改说明（管理员在原文后面追加也行）。 */
export async function updateIncident(
  db: Database,
  id: string,
  patch: { status?: StatusEventStatus; message?: string },
): Promise<StatusEvent | undefined> {
  const [row] = await db
    .update(statusEvents)
    .set(patch)
    .where(and(eq(statusEvents.id, id), isNull(statusEvents.resolvedAt)))
    .returning();
  return row;
}

/** 解决：只填 resolvedAt，`status` 保留当时的影响级别（时间线要显示「当时是 outage」）。 */
export async function resolveIncident(
  db: Database,
  id: string,
  now: Date = new Date(),
): Promise<StatusEvent | undefined> {
  const [row] = await db
    .update(statusEvents)
    .set({ resolvedAt: now })
    .where(and(eq(statusEvents.id, id), isNull(statusEvents.resolvedAt)))
    .returning();
  return row;
}

/** 记一次通知广播的时间，5 分钟内的后续更新不再重复发送（见 status.ts 的 shouldNotify）。 */
export async function markNotified(db: Database, id: string, now: Date) {
  await db
    .update(statusEvents)
    .set({ notifiedAt: now })
    .where(eq(statusEvents.id, id));
}
