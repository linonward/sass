// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import { createRegistrationAttribution } from "./registration";
import { captureEntry } from "./context";
import {
  readContext,
  RETRY_COOKIE,
  signContext,
  SOURCE_COOKIE,
} from "./tokens";
const secret = "test-acquisition-registration-secret";
const snapshot = captureEntry(
  { pathname: "/pricing", utm_source: "launch" },
  "site.test",
)!;
const headers = new Headers({
  cookie: `${SOURCE_COOKIE}=${signContext({ v: 1, purpose: "source", attribution: snapshot }, secret)}`,
});

describe("new-user attribution hook", () => {
  test("freezes validated creation context", async () => {
    const freeze = vi.fn().mockResolvedValue(undefined);
    await createRegistrationAttribution({
      enabled: true,
      secret,
      freeze,
      warn: vi.fn(),
    })("user", headers);
    expect(freeze).toHaveBeenCalledWith("user", snapshot, expect.any(Number));
  });
  test("disabled, missing and tampered contexts never write", async () => {
    const freeze = vi.fn();
    await createRegistrationAttribution({
      enabled: false,
      secret,
      freeze,
      warn: vi.fn(),
    })("user", headers);
    const hook = createRegistrationAttribution({
      enabled: true,
      secret,
      freeze,
      warn: vi.fn(),
    });
    await hook("user");
    await hook("user", new Headers({ cookie: `${SOURCE_COOKIE}=forged` }));
    expect(freeze).not.toHaveBeenCalled();
  });
  test("write failure does not reject registration, creates exact user-bound retry; cookie failure also does not reject", async () => {
    const freeze = vi.fn().mockRejectedValue(new Error("db unavailable"));
    const setCookie = vi.fn();
    const warn = vi.fn();
    const hook = createRegistrationAttribution({
      enabled: true,
      secret,
      freeze,
      warn,
    });
    await expect(hook("new-user", headers, setCookie)).resolves.toBeUndefined();
    expect(setCookie).toHaveBeenCalledWith(
      RETRY_COOKIE,
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        maxAge: 86400,
      }),
    );
    expect(readContext(setCookie.mock.calls[0]![1], secret)).toMatchObject({
      userId: "new-user",
      attribution: snapshot,
    });
    await expect(
      hook("new-user", headers, () => {
        throw new Error("closed");
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("acquisition.retry_cookie_failed", {
      userId: "new-user",
    });
  });
});
