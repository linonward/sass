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
  test("calls every hook in registration order with the user info", async () => {
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

  test("throws OnUserDeleteError when a hook fails and skips the remaining hooks", async () => {
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

  test("re-registering the same name replaces the handler and moves it to the end", async () => {
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

  test("completes normally when no hooks are registered", async () => {
    await expect(runOnUserDelete(user)).resolves.toBeUndefined();
  });
});
