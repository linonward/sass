import { describe, expect, test } from "vitest";

import { fillDays, metricWindow, parseRange } from "./metrics";

describe("parseRange", () => {
  test("只接受 7 / 30 / 90，其他值按 30 天", () => {
    expect(parseRange("7")).toBe(7);
    expect(parseRange("90")).toBe(90);
    for (const value of [undefined, "", "14", "7.0x", ["7"], "-30"]) {
      expect(parseRange(value)).toBe(30);
    }
  });
});

describe("metricWindow", () => {
  test("从 range - 1 天前的 UTC 零点开始，最后一天是今天", () => {
    const window = metricWindow(7, new Date("2026-03-02T23:30:00+08:00"));
    expect(window.since.toISOString()).toBe("2026-02-24T00:00:00.000Z");
    expect(window.days).toEqual([
      "2026-02-24",
      "2026-02-25",
      "2026-02-26",
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
  });
});

describe("fillDays", () => {
  test("没有数据的天补 0，区间外的行忽略", () => {
    expect(
      fillDays(
        ["2026-01-01", "2026-01-02", "2026-01-03"],
        [
          { day: "2026-01-02", value: 5 },
          { day: "2025-12-31", value: 9 },
        ],
      ),
    ).toEqual([
      { day: "2026-01-01", value: 0 },
      { day: "2026-01-02", value: 5 },
      { day: "2026-01-03", value: 0 },
    ]);
  });
});
