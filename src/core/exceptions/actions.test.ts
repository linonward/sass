import { beforeEach, describe, expect, test, vi } from "vitest";

// Server Action 可以绕过页面直接调用：这里验证它自己拦住非管理员、缺理由和不合法的输入，
// 而且被拦时根本不碰服务层。
const session = vi.hoisted(() => ({
  current: null as null | { user: { id: string } },
}));
const service = vi.hoisted(() => ({
  retryReclaim: vi.fn(),
  recheck: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock("@/core/admin/session", () => ({
  getAdminSession: async () => session.current,
}));
vi.mock("./index", () => ({ exceptionService: service }));

const { exceptionAction } = await import("./actions");

const EXCEPTION_ID = "0b3c5a7e-9f1d-4c2b-8a6e-1d2f3a4b5c6d";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("exceptionAction", () => {
  beforeEach(() => {
    session.current = null;
    vi.clearAllMocks();
  });

  test("非管理员（含未登录）直接调用：forbidden，不碰服务层", async () => {
    const result = await exceptionAction(
      { status: "idle" },
      form({ exceptionId: EXCEPTION_ID, action: "retry_reclaim", reason: "x" }),
    );
    expect(result).toEqual({ status: "error", error: "forbidden" });
    expect(service.retryReclaim).not.toHaveBeenCalled();
  });

  test.each([
    [
      { exceptionId: EXCEPTION_ID, action: "resolve", reason: "   " },
      "reasonRequired",
    ],
    [{ exceptionId: EXCEPTION_ID, action: "resolve" }, "reasonRequired"],
    [{ exceptionId: "not-a-uuid", action: "resolve", reason: "ok" }, "invalid"],
    [
      { exceptionId: EXCEPTION_ID, action: "refund_all", reason: "ok" },
      "invalid",
    ],
  ])("输入 %j → %s", async (fields, error) => {
    session.current = { user: { id: "admin-1" } };
    expect(await exceptionAction({ status: "idle" }, form(fields))).toEqual({
      status: "error",
      error,
    });
    expect(service.resolve).not.toHaveBeenCalled();
  });

  test("管理员：动作带上操作者和去掉首尾空白的理由；已处理的单子报 notOpen", async () => {
    session.current = { user: { id: "admin-1" } };
    service.resolve.mockResolvedValueOnce({
      ok: true,
      result: "ignored",
      closed: true,
    });
    expect(
      await exceptionAction(
        { status: "idle" },
        form({
          exceptionId: EXCEPTION_ID,
          action: "ignore",
          reason: "  written off ",
        }),
      ),
    ).toEqual({ status: "success", result: "ignored", closed: true });
    expect(service.resolve).toHaveBeenCalledWith({
      exceptionId: EXCEPTION_ID,
      reason: "written off",
      actorId: "admin-1",
      status: "ignored",
    });

    service.retryReclaim.mockResolvedValueOnce({
      ok: false,
      error: "not_open",
    });
    expect(
      await exceptionAction(
        { status: "idle" },
        form({
          exceptionId: EXCEPTION_ID,
          action: "retry_reclaim",
          reason: "again",
        }),
      ),
    ).toEqual({ status: "error", error: "notOpen" });
  });
});
