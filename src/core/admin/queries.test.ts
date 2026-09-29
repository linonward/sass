import { describe, expect, test } from "vitest";

import { parseOrderStatus, parseSubscriptionStatus } from "./queries";

describe("列表参数", () => {
  test("status 不在取值范围内时不筛选", () => {
    expect(parseOrderStatus("paid")).toBe("paid");
    expect(parseOrderStatus("active")).toBeUndefined();
    expect(parseSubscriptionStatus("past_due")).toBe("past_due");
    expect(parseSubscriptionStatus(undefined)).toBeUndefined();
  });
});
