import { afterEach, describe, expect, test, vi } from "vitest";

import {
  OnUserDeleteError,
  onUserDeleteHandlers,
  registerOnUserDelete,
  resetOnUserDelete,
  runOnUserDelete,
} from "./on-user-delete";

const user = { userId: "u1", email: "a@example.com" };

afterEach(() => {
  resetOnUserDelete();
  vi.restoreAllMocks();
});

describe("onUserDelete", () => {
  test("按注册顺序调用每个钩子，并传入用户信息", async () => {
    const calls: string[] = [];
    registerOnUserDelete("billing", async (u) => {
      calls.push(`billing:${u.userId}`);
    });
    registerOnUserDelete("storage", (u) => {
      calls.push(`storage:${u.email}`);
    });

    await runOnUserDelete(user);

    expect(calls).toEqual(["billing:u1", "storage:a@example.com"]);
  });

  test("某个钩子失败时抛出 OnUserDeleteError，后面的钩子不再执行", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const later = vi.fn();
    registerOnUserDelete("billing", () => {
      throw new Error("provider down");
    });
    registerOnUserDelete("storage", later);

    const run = runOnUserDelete(user);

    await expect(run).rejects.toBeInstanceOf(OnUserDeleteError);
    await expect(run).rejects.toMatchObject({ handler: "billing" });
    expect(later).not.toHaveBeenCalled();
  });

  test("同名重复注册会覆盖，且移到队尾", async () => {
    const first = vi.fn();
    const second = vi.fn();
    registerOnUserDelete("billing", first);
    registerOnUserDelete("storage", vi.fn());
    registerOnUserDelete("billing", second);

    await runOnUserDelete(user);

    expect(onUserDeleteHandlers()).toEqual(["storage", "billing"]);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(user);
  });

  test("没有注册任何钩子时正常完成", async () => {
    await expect(runOnUserDelete(user)).resolves.toBeUndefined();
  });
});
