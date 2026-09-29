// @vitest-environment node
import { afterEach, describe, expect, test, vi } from "vitest";

const after = vi.hoisted(() => vi.fn());
vi.mock("next/server", () => ({ after }));

import { runAfterResponse } from "./after-response";

afterEach(() => {
  after.mockReset();
});

describe("runAfterResponse", () => {
  test("inside a request, hands the task to after instead of running it now", async () => {
    const task = vi.fn(async () => {});
    await runAfterResponse(task);
    expect(after).toHaveBeenCalledWith(task);
    expect(task).not.toHaveBeenCalled();
  });

  test("outside a request scope, runs the task directly and awaits it", async () => {
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
