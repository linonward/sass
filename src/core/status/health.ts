import { and, eq, inArray, isNull } from "drizzle-orm";

import type { StatusPageConfig, StatusComponent } from "@/core/config/schema";
import type { Database } from "@/core/db/client";
import { statusChecks, statusEvents } from "@/core/db/schema/status";
import { logger } from "@/core/observability/logger";

import { createIncident } from "./store";

/**
 * Timeout for a single probe. The status page is itself the page people open during an outage; it
 * must not hang on one broken endpoint.
 */
export const HEALTH_TIMEOUT_MS = 5_000;

/**
 * How many consecutive failures before a component is marked degraded. A single failure may just
 * be a network blip: the probe runs on the render path, and a momentary blip from a second ago
 * shouldn't become a publicly visible incident.
 */
export const FAILURE_THRESHOLD = 2;

export type ProbeResult =
  { ok: true; status: number } | { ok: false; error: string };

/**
 * Probes a health URL: 2xx–3xx counts as healthy; everything else (including timeouts and network
 * errors) counts as a failure.
 *
 * The timeout uses `AbortSignal.timeout`, so the probe always returns within `timeoutMs` — the
 * caller (rendering `/status`) is never held up by an unresponsive address.
 */
export async function probeHealth(
  url: string,
  {
    timeoutMs = HEALTH_TIMEOUT_MS,
    fetchImpl = fetch,
  }: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<ProbeResult> {
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "*/*" },
    });
    // Don't read the body: health checks only look at the status code, and an unconsumed response
    // holds on to the connection.
    await response.body?.cancel().catch(() => {});
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    return { ok: true, status: response.status };
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return { ok: false, error: `timeout after ${timeoutMs}ms` };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export type CheckTarget = { component: string; healthUrl: string };

/**
 * Components with a healthUrl configured. Components without one are still controlled manually by
 * the admin in auto mode.
 */
export function checkTargets(
  components: Record<string, StatusComponent>,
): CheckTarget[] {
  return Object.entries(components).flatMap(([component, config]) =>
    config.healthUrl ? [{ component, healthUrl: config.healthUrl }] : [],
  );
}

function autoIncidentMessage(result: Extract<ProbeResult, { ok: false }>) {
  return `Health check failed: ${result.error}`;
}

/**
 * Whether this failure should open an incident: consecutive failures have reached the threshold
 * and no automatic incident is currently ongoing. Extracted as a pure function so it can be unit
 * tested — the actual write happens in `runAutoChecks`.
 */
export function shouldOpenIncident(
  failures: number,
  hasOpenAutoIncident: boolean,
): boolean {
  return failures >= FAILURE_THRESHOLD && !hasOpenAutoIncident;
}

/**
 * Probes for auto mode: run synchronously while the page renders (v1 has no cron).
 *
 * Bookkeeping per component:
 * - probe succeeds → reset the failure count, and resolve the incidents it opened **itself**
 *   (`source = "auto"`; incidents an admin opened manually are never quietly closed by an
 *   automatic recovery);
 * - probe fails → count +1; once it reaches `FAILURE_THRESHOLD` and no automatic incident is
 *   ongoing, open a degraded incident.
 *
 * Probes run in parallel, writes run one at a time — each component's two row writes are
 * independent, so there's no need for a transaction.
 */
export async function runAutoChecks(
  db: Database,
  config: Pick<StatusPageConfig, "components">,
  {
    now = new Date(),
    probe = probeHealth,
  }: { now?: Date; probe?: typeof probeHealth } = {},
): Promise<void> {
  const targets = checkTargets(config.components);
  if (targets.length === 0) return;

  const results = await Promise.all(
    targets.map(async ({ component, healthUrl }) => ({
      component,
      result: await probe(healthUrl),
    })),
  );

  const existing = await db
    .select({
      component: statusChecks.component,
      consecutiveFailures: statusChecks.consecutiveFailures,
    })
    .from(statusChecks)
    .where(
      inArray(
        statusChecks.component,
        targets.map((target) => target.component),
      ),
    );
  const previousFailures = new Map(
    existing.map((row) => [row.component, row.consecutiveFailures]),
  );

  for (const { component, result } of results) {
    if (result.ok) {
      await db
        .insert(statusChecks)
        .values({
          component,
          consecutiveFailures: 0,
          lastCheckedAt: now,
          lastOk: true,
          lastError: null,
        })
        .onConflictDoUpdate({
          target: statusChecks.component,
          set: {
            consecutiveFailures: 0,
            lastCheckedAt: now,
            lastOk: true,
            lastError: null,
          },
        });
      await db
        .update(statusEvents)
        .set({ resolvedAt: now })
        .where(
          and(
            eq(statusEvents.component, component),
            eq(statusEvents.source, "auto"),
            isNull(statusEvents.resolvedAt),
          ),
        );
      continue;
    }

    const failures = (previousFailures.get(component) ?? 0) + 1;
    logger.warn("status.health_check_failed", {
      component,
      failures,
      error: result.error,
    });
    await db
      .insert(statusChecks)
      .values({
        component,
        consecutiveFailures: failures,
        lastCheckedAt: now,
        lastOk: false,
        lastError: result.error,
      })
      .onConflictDoUpdate({
        target: statusChecks.component,
        set: {
          consecutiveFailures: failures,
          lastCheckedAt: now,
          lastOk: false,
          lastError: result.error,
        },
      });
    const open = await db
      .select({ id: statusEvents.id })
      .from(statusEvents)
      .where(
        and(
          eq(statusEvents.component, component),
          eq(statusEvents.source, "auto"),
          isNull(statusEvents.resolvedAt),
        ),
      )
      .limit(1);
    if (!shouldOpenIncident(failures, open.length > 0)) continue;

    await createIncident(db, {
      component,
      status: "degraded",
      message: autoIncidentMessage(result),
      source: "auto",
    });
  }
}
