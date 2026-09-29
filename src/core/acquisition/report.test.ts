import { describe, expect, test } from "vitest";

import { mergeRows, NO_SOURCE_BUCKET, parseReportFilters } from "./report";

describe("parseReportFilters", () => {
  test("accepts sources that can appear in snapshots: utm values, external domains, direct, and unknown", () => {
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

  test("accepts the synthetic bucket too: it's a table row, so the filter must be able to select it", () => {
    expect(parseReportFilters({ source: NO_SOURCE_BUCKET })).toEqual({
      source: NO_SOURCE_BUCKET,
    });
  });

  test("values outside the allowlist are treated as absent and never reach the query", () => {
    // Values with quotes, semicolons, or newlines are neither valid utm values nor valid hostnames.
    for (const source of [
      "launch';drop table",
      "launch\n",
      "http://evil.example/path",
      "",
    ])
      expect(parseReportFilters({ source })).toEqual({ source: undefined });
    // One invalid field doesn't affect the others.
    expect(parseReportFilters({ source: "launch", medium: "!!" })).toEqual({
      source: "launch",
      medium: undefined,
    });
    // Too long (utm > 80 chars; hostname max 253) is rejected.
    expect(parseReportFilters({ source: "a".repeat(300) })).toEqual({
      source: undefined,
    });
  });

  test("repeated query params (arrays) and missing ones don't count as filters", () => {
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
  confirmedLeads: [] as { source: string; value: number }[],
};

describe("mergeRows", () => {
  test("a source in any aggregate gets a row, with 0 for missing values", () => {
    const rows = mergeRows({
      ...empty,
      confirmedLeads: [],
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
        confirmedLeads: 0,
        conversionRate: 0,
        revenue: [],
        pending: [{ currency: "USD", amount: 400 }],
      },
      {
        source: "unknown",
        registrations: 1,
        payingUsers: 0,
        confirmedLeads: 0,
        conversionRate: 0,
        revenue: [{ currency: "USD", amount: 1900 }],
        pending: [],
      },
    ]);
  });

  test("currencies with zero net revenue are omitted (full refunds); needs-reconciling amounts are still listed", () => {
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

  test("sorting: most registrations first, then paying users, then source name", () => {
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
