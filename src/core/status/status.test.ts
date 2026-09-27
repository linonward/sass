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
  test("没有未解决的事件就是 operational", () => {
    expect(getComponentStatus([])).toEqual({
      status: "operational",
      message: null,
      since: null,
      incidentId: null,
    });
  });

  test("只有已解决的事件也是 operational", () => {
    const status = getComponentStatus([
      event({ resolvedAt: hoursAgo(0.5), status: "outage" }),
    ]);
    expect(status.status).toBe("operational");
    expect(status.since).toBeNull();
  });

  test("未解决的事件决定状态、说明和开始时间", () => {
    const open = event({ status: "outage", message: "API is down" });
    expect(getComponentStatus([open])).toEqual({
      status: "outage",
      message: "API is down",
      since: open.createdAt,
      incidentId: open.id,
    });
  });

  test("多条未解决时以最近的一条为准（取数那边按时间倒序传进来）", () => {
    const older = event({
      id: "a",
      status: "degraded",
      createdAt: hoursAgo(3),
    });
    const newer = event({ id: "b", status: "outage", createdAt: hoursAgo(1) });
    expect(getComponentStatus([newer, older]).incidentId).toBe("b");
  });

  test("operational 的事件是「没有影响的公告」：状态不变，但带上说明", () => {
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
  test("outage 压过 degraded，都没有才是 operational", () => {
    expect(overallStatus(["operational", "degraded"])).toBe("degraded");
    expect(overallStatus(["degraded", "outage"])).toBe("outage");
    expect(overallStatus(["operational", "operational"])).toBe("operational");
    expect(overallStatus([])).toBe("operational");
  });
});

describe("getUptime", () => {
  const days = 30;

  test("没有事件时是 100", () => {
    expect(getUptime([], { now, days })).toBe(100);
  });

  test("窗口内的 downtime 按比例扣", () => {
    // 30 天里坏了 1 天 → 96.67%。
    const outage = event({
      createdAt: hoursAgo(24),
      resolvedAt: now,
      status: "outage",
    });
    expect(getUptime([outage], { now, days })).toBeCloseTo((29 / 30) * 100, 6);
  });

  test("进行中的事件按 now 收尾", () => {
    const outage = event({ createdAt: hoursAgo(12), resolvedAt: null });
    expect(getUptime([outage], { now, days })).toBeCloseTo(
      (29.5 / 30) * 100,
      6,
    );
  });

  test("超出窗口的部分被裁掉（起点在窗口之前）", () => {
    const outage = event({ createdAt: hoursAgo(24 * 40), resolvedAt: now });
    // 整段都比窗口长 → 全窗口不可用。
    expect(getUptime([outage], { now, days })).toBe(0);
  });

  test("窗口之前就结束的事件不算", () => {
    const outage = event({
      createdAt: hoursAgo(24 * 40),
      resolvedAt: hoursAgo(24 * 31),
    });
    expect(getUptime([outage], { now, days })).toBe(100);
  });

  test("多起重叠的 incident 时长累加，但不会算出负的 uptime", () => {
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

  test("operational 的公告不计入 downtime", () => {
    const notice = event({
      status: "operational",
      createdAt: hoursAgo(48),
      resolvedAt: now,
    });
    const degraded = event({ createdAt: hoursAgo(24), resolvedAt: now });
    const withNotice = getUptime([notice, degraded], { now, days });
    expect(withNotice).toBeCloseTo(getUptime([degraded], { now, days }), 6);
  });

  test("窗口为 0 时返回 100 而不是 NaN", () => {
    expect(getUptime([event()], { now, days: 0 })).toBe(100);
  });
});

describe("shouldNotify", () => {
  test("没发过就发", () => {
    expect(shouldNotify({ notifiedAt: null }, now)).toBe(true);
  });

  test("窗口内不发：同一 incident 的创建 / 更新 / 解决合并成一封", () => {
    const notifiedAt = new Date(now.getTime() - 60_000);
    expect(shouldNotify({ notifiedAt }, now)).toBe(false);
  });

  test("正好到窗口边界就发", () => {
    const notifiedAt = new Date(now.getTime() - NOTIFY_MERGE_WINDOW_MS);
    expect(shouldNotify({ notifiedAt }, now)).toBe(true);
  });

  test("窗口可调，常见用法是传 5 分钟", () => {
    expect(NOTIFY_MERGE_WINDOW_MS).toBe(5 * 60 * 1000);
    const notifiedAt = new Date(now.getTime() - 120_000);
    expect(shouldNotify({ notifiedAt }, now, 60_000)).toBe(true);
    expect(shouldNotify({ notifiedAt }, now, 5 * 60_000)).toBe(false);
  });
});

describe("componentLabel", () => {
  test("组件还在配置里时用展示名，删掉了就回退成 key", () => {
    const components = { api: { label: "API" } };
    expect(componentLabel(components, "api")).toBe("API");
    expect(componentLabel(components, "database")).toBe("database");
  });
});
