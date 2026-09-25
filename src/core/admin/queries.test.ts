import { describe, expect, test } from "vitest";

import {
  parseOrderStatus,
  parsePage,
  parseSubscriptionStatus,
} from "./queries";

describe("列表参数", () => {
  test("page 只接受正整数", () => {
    expect(parsePage("3")).toBe(3);
    for (const value of [undefined, "", "0", "-1", "1.5", "abc", ["2"]]) {
      expect(parsePage(value)).toBe(1);
    }
  });

  test("status 不在取值范围内时不筛选", () => {
    expect(parseOrderStatus("paid")).toBe("paid");
    expect(parseOrderStatus("active")).toBeUndefined();
    expect(parseSubscriptionStatus("past_due")).toBe("past_due");
    expect(parseSubscriptionStatus(undefined)).toBeUndefined();
  });
});
