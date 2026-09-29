import { describe, expect, test } from "vitest";

import { withSpan } from "./trace";

// Without a registered OTel provider the span is a no-op: withSpan only needs to pass results and
// errors through.
describe("withSpan", () => {
  test("returns fn's result", async () => {
    await expect(withSpan("test", {}, async () => 42)).resolves.toBe(42);
  });

  test("rethrows fn's error as-is", async () => {
    const error = new Error("boom");
    await expect(
      withSpan("test", {}, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});
