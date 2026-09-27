import { describe, expect, test } from "vitest";

import { mergeRows, parseReportFilters } from "./report";

describe("parseReportFilters", () => {
  test("接受快照里可能出现的来源：utm 值、外部域名、direct 和 unknown", () => {
    expect(parseReportFilters({ source: "launch" })).toEqual({
      source: "launch",
    });
    expect(parseReportFilters({ source: "news.ycombinator.com" })).toEqual({
      source: "news.ycombinator.com",
    });
    expect(parseReportFilters({ source: "direct" })).toEqual({
      source: "direct",
    });
    expect(parseReportFilters({ source: "unknown" })).toEqual({
      source: "unknown",
    });
    expect(parseReportFilters({ medium: "email", campaign: "spring" })).toEqual(
      { medium: "email", campaign: "spring" },
    );
  });

  test("不在白名单里的值当作没传，不带进查询", () => {
    // 含引号、分号、换行的值不是合法 utm，也不是合法 hostname。
    for (const source of [
      "launch';drop table",
      "launch\n",
      "http://evil.example/path",
      "",
    ])
      expect(parseReportFilters({ source })).toEqual({ source: undefined });
    // 一个字段不合法不影响另一个。
    expect(parseReportFilters({ source: "launch", medium: "!!" })).toEqual({
      source: "launch",
      medium: undefined,
    });
    // 超长（>80 字符的 utm；hostname 上限 253）不通过。
    expect(parseReportFilters({ source: "a".repeat(300) })).toEqual({
      source: undefined,
    });
  });

  test("重复的查询参数（数组）和缺省都不算筛选", () => {
    expect(parseReportFilters({ source: ["launch", "other"] })).toEqual({
      source: undefined,
    });
    expect(parseReportFilters({})).toEqual({
      source: undefined,
      medium: undefined,
      campaign: undefined,
    });
  });
});

const empty = {
  registrations: [] as { source: string; value: number }[],
  payers: [] as { source: string; value: number }[],
  revenue: [] as { source: string; currency: string | null; value: number }[],
  pending: [] as { source: string; currency: string | null; value: number }[],
};

describe("mergeRows", () => {
  test("出现在任意一组里的来源都有一行，缺的填 0", () => {
    const rows = mergeRows({
      ...empty,
      registrations: [
        { source: "launch", value: 3 },
        { source: "unknown", value: 1 },
      ],
      payers: [{ source: "launch", value: 1 }],
      revenue: [{ source: "unknown", currency: "USD", value: 1900 }],
      pending: [{ source: "launch", currency: "USD", value: 400 }],
    });
    expect(rows).toEqual([
      {
        source: "launch",
        registrations: 3,
        payingUsers: 1,
        revenue: [],
        pending: [{ currency: "USD", amount: 400 }],
      },
      {
        source: "unknown",
        registrations: 1,
        payingUsers: 0,
        revenue: [{ currency: "USD", amount: 1900 }],
        pending: [],
      },
    ]);
  });

  test("净收入为 0 的币种不列出（全额退款），待核对照列", () => {
    const rows = mergeRows({
      ...empty,
      revenue: [
        { source: "direct", currency: "USD", value: 0 },
        { source: "direct", currency: "EUR", value: 500 },
      ],
      pending: [{ source: "direct", currency: "USD", value: 0 }],
    });
    expect(rows[0]).toMatchObject({
      revenue: [{ currency: "EUR", amount: 500 }],
      pending: [{ currency: "USD", amount: 0 }],
    });
  });

  test("排序：注册多的在前，再按付费人数，最后按来源名", () => {
    const rows = mergeRows({
      ...empty,
      registrations: [
        { source: "b", value: 2 },
        { source: "a", value: 2 },
        { source: "c", value: 5 },
      ],
      payers: [{ source: "a", value: 2 }],
    });
    expect(rows.map((row) => row.source)).toEqual(["c", "a", "b"]);
  });
});
