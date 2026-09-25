import { describe, expect, test } from "vitest";

import { chatErrorCode } from "./playground";

describe("chatErrorCode", () => {
  test.each([
    ['{"error":"insufficient_credits"}', "insufficient_credits"],
    ['{"error":"rate_limited"}', "rate_limited"],
    ["model_error", "model_error"],
    ['{"error":"something_new"}', "generic"],
    ["Failed to fetch", "generic"],
  ])("%s → %s", (message, expected) => {
    expect(chatErrorCode(new Error(message))).toBe(expected);
  });
});
