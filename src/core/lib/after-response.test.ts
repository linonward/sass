// @vitest-environment node
import { afterEach, describe, expect, test, vi } from "vitest";

const after = vi.hoisted(() => vi.fn());
vi.mock("next/server", () => ({ after }));

import { runAfterResponse } from "./after-response";

afterEach(() => {
  after.mockReset();
});

describe("runAfterResponse", () => {
  test("请求里交给 after，不在当下执行", async () => {
    const task = vi.fn(async () => {});
    await runAfterResponse(task);
    expect(after).toHaveBeenCalledWith(task);
    expect(task).not.toHaveBeenCalled();
  });

  test("不在请求作用域时直接执行并等待", async () => {
    after.mockImplementation(() => {
      throw new Error("`after` was called outside a request scope");
    });
    const order: string[] = [];
    await runAfterResponse(async () => {
      await Promise.resolve();
      order.push("task");
    });
    order.push("returned");
    expect(order).toEqual(["task", "returned"]);
  });
});
