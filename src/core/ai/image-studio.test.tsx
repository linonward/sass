import { describe, expect, test } from "vitest";

import { imageErrorCode } from "./image-studio";

describe("imageErrorCode", () => {
  test.each([
    [402, { error: "insufficient_credits" }, "insufficient_credits"],
    [503, { error: "storage_unavailable" }, "storage_unavailable"],
    [503, { error: "unavailable" }, "unavailable"],
    [429, {}, "rate_limited"],
    [500, { error: "something_new" }, "generic"],
  ])("%i %j → %s", async (status, body, expected) => {
    expect(await imageErrorCode(Response.json(body, { status }))).toBe(
      expected,
    );
  });

  test("响应体不是 JSON", async () => {
    expect(await imageErrorCode(new Response("oops", { status: 500 }))).toBe(
      "generic",
    );
  });
});
