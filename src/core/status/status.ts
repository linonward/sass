import type {
  StatusEventSource,
  StatusEventStatus,
} from "@/core/db/schema/status";

/**
 * Pure computations for the status page: current status, uptime, and the notification merge
 * window.
 *
 * Deliberately stays away from the database — the computations (especially uptime's interval
 * overlap) need unit tests; data fetching lives in ./store.ts. Both sides share the `StatusEvent`
 * type below.
 */
export type StatusEvent = {
  id: string;
  component: string;
  status: StatusEventStatus;
  message: string;
  source: StatusEventSource;
  createdAt: Date;
  resolvedAt: Date | null;
  notifiedAt: Date | null;
};

export type ComponentStatus = {
  /** Current impact level; operational when there are no unresolved events. */
  status: StatusEventStatus;
  /** Message of the current incident; null when operational. */
  message: string | null;
  /** Start time of the current incident; null when operational. */
  since: Date | null;
  incidentId: string | null;
};

/** Overall status tiers, matching the three sentences on the banner. */
export type OverallStatus = "operational" | "degraded" | "outage";

const OPERATIONAL: ComponentStatus = {
  status: "operational",
  message: null,
  since: null,
  incidentId: null,
};

/**
 * A component's current status is decided by **the most recent unresolved event**.
 *
 * Events arrive newest first (the query already sorts them). An `operational` event is an
 * "announcement with no impact": matching it still returns operational, just with the message —
 * so an admin can post a notice first and escalate the impact level later.
 */
export function getComponentStatus(events: StatusEvent[]): ComponentStatus {
  const open = events.find((event) => event.resolvedAt === null);
  if (!open) return OPERATIONAL;
  return {
    status: open.status,
    message: open.message,
    since: open.createdAt,
    incidentId: open.id,
  };
}

/** Any outage means outage; otherwise any degraded means degraded; otherwise operational. */
export function overallStatus(statuses: StatusEventStatus[]): OverallStatus {
  if (statuses.includes("outage")) return "outage";
  if (statuses.includes("degraded")) return "degraded";
  return "operational";
}

/**
 * Uptime percentage (0–100) over the last N days.
 *
 * Both degraded and outage count as unavailable: to a visitor, "can sign in but it's slow" and
 * "can't sign in" are both "not fully working", and splitting them would give this number an extra
 * definition nobody can explain. `operational` announcements don't count.
 *
 * Intervals are clipped to the window, and still-ongoing events end at `now`; overlapping
 * incidents can add up to more than the window, so the total is capped at the window length to
 * avoid a negative uptime.
 */
export function getUptime(
  events: StatusEvent[],
  { now = new Date(), days }: { now?: Date; days: number },
): number {
  const windowMs = days * 86_400_000;
  if (windowMs <= 0) return 100;
  const nowMs = now.getTime();
  const startMs = nowMs - windowMs;

  let downtimeMs = 0;
  for (const event of events) {
    if (event.status === "operational") continue;
    const from = Math.max(event.createdAt.getTime(), startMs);
    const to = Math.min((event.resolvedAt ?? now).getTime(), nowMs);
    if (to > from) downtimeMs += to - from;
  }

  const ratio = 1 - Math.min(downtimeMs, windowMs) / windowMs;
  return Math.max(0, Math.min(100, ratio * 100));
}

/**
 * Within this window, the creation, updates, and resolution of one incident send only one
 * notification.
 */
export const NOTIFY_MERGE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Whether this change should notify subscribers.
 *
 * The merge rule lives on the incident row's `notifiedAt`: if an email already went out within the
 * window, skip; the next real send pushes the timestamp forward. It is recorded even when there
 * are no subscribers — a notification means "this incident was broadcast at some moment", not
 * "someone received it".
 */
export function shouldNotify(
  event: Pick<StatusEvent, "notifiedAt">,
  now: Date = new Date(),
  windowMs: number = NOTIFY_MERGE_WINDOW_MS,
): boolean {
  if (!event.notifiedAt) return true;
  return now.getTime() - event.notifiedAt.getTime() >= windowMs;
}

/**
 * Display label for a component; falls back to the key itself once the component is no longer in
 * `statusPage.components`.
 */
export function componentLabel(
  components: Record<string, { label: string }>,
  component: string,
): string {
  return components[component]?.label ?? component;
}
