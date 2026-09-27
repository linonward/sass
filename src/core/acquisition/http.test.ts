// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { captureEntry } from "./context";
import { createAttributionHandlers } from "./http";
import {
  RETRY_COOKIE,
  SOURCE_COOKIE,
  SOURCE_CHOICE_COOKIE,
  signContext,
} from "./tokens";
const secret = "test-acquisition-http-secret";
const url = "http://localhost:3100/api/acquisition/attribution";
const snapshot = captureEntry(
  { pathname: "/", utm_source: "first" },
  "localhost",
)!;
const token = signContext(
  { v: 1, purpose: "source", attribution: snapshot },
  secret,
);
const store = { freeze: vi.fn(), withdraw: vi.fn() };
const getUserId = vi.fn();
const warn = vi.fn();
const handlers = (enabled = true) =>
  createAttributionHandlers({ enabled, secret, store, getUserId, warn });
const request = (
  body: unknown,
  cookie = "",
  origin = "http://localhost:3100",
) =>
  new Request(url, {
    method: "POST",
    headers: { origin, "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  getUserId.mockResolvedValue(null);
});
describe("attribution API", () => {
  test("disabled returns 404 and never queries identity or storage", async () => {
    expect(handlers(false).GET(new Request(url)).status).toBe(404);
    expect(
      (await handlers(false).POST(request({ action: "withdraw" }))).status,
    ).toBe(404);
    expect(getUserId).not.toHaveBeenCalled();
  });
  test("cross-origin, unknown fields and oversized requests are rejected", async () => {
    expect(
      (
        await handlers().POST(
          request({ action: "accept", entry: {} }, "", "https://evil.test"),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handlers().POST(
          request({
            action: "accept",
            entry: { pathname: "/", email: "secret" },
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handlers().POST(
          request({
            action: "accept",
            entry: { pathname: "/" },
            extra: "x".repeat(5000),
          }),
        )
      ).status,
    ).toBe(400);
  });
  test("accept sets httpOnly lax cookie; later campaigns cannot refresh first-touch", async () => {
    const response = await handlers().POST(
      request({
        action: "accept",
        entry: { pathname: "/", utm_source: "first" },
      }),
    );
    expect(response.cookies.get(SOURCE_COOKIE)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      maxAge: 2592000,
    });
    const returned = await handlers().POST(
      request(
        { action: "accept", entry: { pathname: "/", utm_source: "second" } },
        `${SOURCE_COOKIE}=${token}`,
      ),
    );
    expect(returned.cookies.get(SOURCE_COOKIE)).toBeUndefined();
    expect(getUserId).not.toHaveBeenCalled();
  });
  test("withdraw clears cookies and authenticated snapshot; failure is retryable and still expires cookies", async () => {
    getUserId.mockResolvedValue("user");
    const response = await handlers().POST(request({ action: "withdraw" }));
    expect(store.withdraw).toHaveBeenCalledWith("user");
    expect(response.cookies.get(SOURCE_CHOICE_COOKIE)?.value).toBe("declined");
    expect(response.cookies.get(SOURCE_COOKIE)?.maxAge).toBe(0);
    expect(response.cookies.get(RETRY_COOKIE)?.maxAge).toBe(0);
    store.withdraw.mockRejectedValueOnce(new Error("db failed"));
    const failed = await handlers().POST(request({ action: "withdraw" }));
    expect(failed.status).toBe(503);
    expect(failed.cookies.get(SOURCE_CHOICE_COOKIE)?.value).toBe("declined");
    expect(failed.cookies.get(SOURCE_COOKIE)?.maxAge).toBe(0);
  });
  test("retry only writes signed user identity and exact snapshot, not client fields", async () => {
    const pending = signContext(
      {
        v: 1,
        purpose: "registration",
        userId: "new-user",
        registeredAt: Date.now(),
        attribution: snapshot,
      },
      secret,
    );
    const cookie = `${RETRY_COOKIE}=${pending}`;
    getUserId.mockResolvedValue("other");
    expect(
      (await handlers().POST(request({ action: "sync" }, cookie))).status,
    ).toBe(401);
    expect(store.freeze).not.toHaveBeenCalled();
    getUserId.mockResolvedValue("new-user");
    const response = await handlers().POST(request({ action: "sync" }, cookie));
    expect(store.freeze).toHaveBeenCalledWith(
      "new-user",
      snapshot,
      expect.any(Number),
    );
    expect(response.cookies.get(RETRY_COOKIE)?.maxAge).toBe(0);
    const forged = await handlers().POST(
      request({ action: "sync" }, `${RETRY_COOKIE}=forged`),
    );
    expect(await forged.json()).toEqual({ synced: false });
  });
});
