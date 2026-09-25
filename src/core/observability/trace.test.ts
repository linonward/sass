import { describe, expect, test } from "vitest";

import { withSpan } from "./trace";

// 没有注册 OTel 时 span 是空实现：withSpan 只需要透传结果和错误。
describe("withSpan", () => {
  test("返回 fn 的结果", async () => {
    await expect(withSpan("test", {}, async () => 42)).resolves.toBe(42);
  });

  test("fn 抛错时原样抛出", async () => {
    const error = new Error("boom");
    await expect(
      withSpan("test", {}, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});
