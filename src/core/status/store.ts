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

/** Cap on incidents in the timeline; older records outside the window stay off the first screen. */
const INCIDENT_LIMIT = 50;

export type StatusBoardComponent = {
  key: string;
  label: string;
  description?: string;
  status: ComponentStatus;
  /** Uptime percentage within the window. */
  uptime: number;
};

export type StatusBoard = {
  overall: OverallStatus;
  components: StatusBoardComponent[];
  /** Incidents within the window, newest first. */
  incidents: StatusEvent[];
};

/** Incidents that overlap the window: started in it, ended in it, or still ongoing. */
function inWindow(since: Date) {
  return or(
    gte(statusEvents.createdAt, since),
    gte(statusEvents.resolvedAt, since),
    isNull(statusEvents.resolvedAt),
  );
}

/**
 * All incidents in the window, plus those still ongoing (the latter aren't subject to the window
 * or the count cap).
 */
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

/**
 * Everything the status page's first screen needs: overall status, each component's current
 * status and uptime, and recent incidents.
 */
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

/** Current status of one component (no window filter: an ongoing incident always counts). */
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

/** Uptime percentage over the last N days. */
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

/**
 * Updates an ongoing incident: changes the impact level or the message (admins may also append to
 * the original text).
 */
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

/**
 * Resolves an incident: only sets resolvedAt; `status` keeps the impact level it had (the timeline
 * needs to show "this was an outage").
 */
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

/**
 * Records when a notification was broadcast; follow-up changes within 5 minutes aren't sent again
 * (see shouldNotify in status.ts).
 */
export async function markNotified(db: Database, id: string, now: Date) {
  await db
    .update(statusEvents)
    .set({ notifiedAt: now })
    .where(eq(statusEvents.id, id));
}
