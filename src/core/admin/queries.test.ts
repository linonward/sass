import { describe, expect, test } from "vitest";

import { parseOrderStatus, parseSubscriptionStatus } from "./queries";

describe("list params", () => {
  test("status outside the allowed set means no filter", () => {
    expect(parseOrderStatus("paid")).toBe("paid");
    expect(parseOrderStatus("active")).toBeUndefined();
    expect(parseSubscriptionStatus("past_due")).toBe("past_due");
    expect(parseSubscriptionStatus(undefined)).toBeUndefined();
  });
});
