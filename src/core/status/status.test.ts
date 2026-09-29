import { describe, expect, test } from "vitest";

import {
  componentLabel,
  getComponentStatus,
  getUptime,
  NOTIFY_MERGE_WINDOW_MS,
  overallStatus,
  shouldNotify,
  type StatusEvent,
} from "./status";

const now = new Date("2026-09-27T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

function event(overrides: Partial<StatusEvent> = {}): StatusEvent {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    component: "api",
    status: "degraded",
    message: "Slow responses",
    source: "manual",
    createdAt: hoursAgo(1),
    resolvedAt: null,
    notifiedAt: null,
    ...overrides,
  };
}

describe("getComponentStatus", () => {
  test("no unresolved events means operational", () => {
    expect(getComponentStatus([])).toEqual({
      status: "operational",
      message: null,
      since: null,
      incidentId: null,
    });
  });

  test("only resolved events is also operational", () => {
    const status = getComponentStatus([
      event({ resolvedAt: hoursAgo(0.5), status: "outage" }),
    ]);
    expect(status.status).toBe("operational");
    expect(status.since).toBeNull();
  });

  test("an unresolved event determines status, message, and start time", () => {
    const open = event({ status: "outage", message: "API is down" });
    expect(getComponentStatus([open])).toEqual({
      status: "outage",
      message: "API is down",
      since: open.createdAt,
      incidentId: open.id,
    });
  });

  test("with several unresolved, the most recent wins (the query passes them newest first)", () => {
    const older = event({
      id: "a",
      status: "degraded",
      createdAt: hoursAgo(3),
    });
    const newer = event({ id: "b", status: "outage", createdAt: hoursAgo(1) });
    expect(getComponentStatus([newer, older]).incidentId).toBe("b");
  });

  test("an operational event is a no-impact announcement: status stays, message is included", () => {
    const notice = event({
      status: "operational",
      message: "Maintenance window",
    });
    expect(getComponentStatus([notice])).toEqual({
      status: "operational",
      message: "Maintenance window",
      since: notice.createdAt,
      incidentId: notice.id,
    });
    expect(overallStatus([getComponentStatus([notice]).status])).toBe(
      "operational",
    );
  });
});

describe("overallStatus", () => {
  test("outage beats degraded; operational only when neither is present", () => {
    expect(overallStatus(["operational", "degraded"])).toBe("degraded");
    expect(overallStatus(["degraded", "outage"])).toBe("outage");
    expect(overallStatus(["operational", "operational"])).toBe("operational");
    expect(overallStatus([])).toBe("operational");
  });
});

describe("getUptime", () => {
  const days = 30;

  test("is 100 with no events", () => {
    expect(getUptime([], { now, days })).toBe(100);
  });

  test("downtime within the window is deducted proportionally", () => {
    // 1 day down out of 30 → 96.67%.
    const outage = event({
      createdAt: hoursAgo(24),
      resolvedAt: now,
      status: "outage",
    });
    expect(getUptime([outage], { now, days })).toBeCloseTo((29 / 30) * 100, 6);
  });

  test("an ongoing event is closed off at now", () => {
    const outage = event({ createdAt: hoursAgo(12), resolvedAt: null });
    expect(getUptime([outage], { now, days })).toBeCloseTo(
      (29.5 / 30) * 100,
      6,
    );
  });

  test("the part outside the window is clipped (starts before the window)", () => {
    const outage = event({ createdAt: hoursAgo(24 * 40), resolvedAt: now });
    // The event is longer than the whole window → the entire window is unavailable.
    expect(getUptime([outage], { now, days })).toBe(0);
  });

  test("events that ended before the window don't count", () => {
    const outage = event({
      createdAt: hoursAgo(24 * 40),
      resolvedAt: hoursAgo(24 * 31),
    });
    expect(getUptime([outage], { now, days })).toBe(100);
  });

  test("overlapping incidents add up, but never produce a negative uptime", () => {
    const first = event({
      id: "a",
      createdAt: hoursAgo(24 * 20),
      resolvedAt: now,
    });
    const second = event({
      id: "b",
      createdAt: hoursAgo(24 * 20),
      resolvedAt: now,
    });
    expect(getUptime([first, second], { now, days })).toBe(0);
  });

  test("operational announcements don't count as downtime", () => {
    const notice = event({
      status: "operational",
      createdAt: hoursAgo(48),
      resolvedAt: now,
    });
    const degraded = event({ createdAt: hoursAgo(24), resolvedAt: now });
    const withNotice = getUptime([notice, degraded], { now, days });
    expect(withNotice).toBeCloseTo(getUptime([degraded], { now, days }), 6);
  });

  test("returns 100 rather than NaN for a zero-length window", () => {
    expect(getUptime([event()], { now, days: 0 })).toBe(100);
  });
});

describe("shouldNotify", () => {
  test("sends if never sent", () => {
    expect(shouldNotify({ notifiedAt: null }, now)).toBe(true);
  });

  test("doesn't send within the window: create / update / resolve of one incident merge into one email", () => {
    const notifiedAt = new Date(now.getTime() - 60_000);
    expect(shouldNotify({ notifiedAt }, now)).toBe(false);
  });

  test("sends exactly at the window boundary", () => {
    const notifiedAt = new Date(now.getTime() - NOTIFY_MERGE_WINDOW_MS);
    expect(shouldNotify({ notifiedAt }, now)).toBe(true);
  });

  test("the window is configurable; the usual value is 5 minutes", () => {
    expect(NOTIFY_MERGE_WINDOW_MS).toBe(5 * 60 * 1000);
    const notifiedAt = new Date(now.getTime() - 120_000);
    expect(shouldNotify({ notifiedAt }, now, 60_000)).toBe(true);
    expect(shouldNotify({ notifiedAt }, now, 5 * 60_000)).toBe(false);
  });
});

describe("componentLabel", () => {
  test("uses the display name while the component is configured, falls back to the key once removed", () => {
    const components = { api: { label: "API" } };
    expect(componentLabel(components, "api")).toBe("API");
    expect(componentLabel(components, "database")).toBe("database");
  });
});
