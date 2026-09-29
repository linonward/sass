// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { captureEntry } from "./context";
import { newReferralCode } from "./referrals/code";
import { REFERRAL_COOKIE, signContext, SOURCE_COOKIE } from "./tokens";

const { bind, freeze, send, track } = vi.hoisted(() => ({
  bind: vi.fn(),
  freeze: vi.fn(),
  send: vi.fn(),
  track: vi.fn(),
}));
vi.mock("../../../site.config", async (original) => {
  const configModule = await original<typeof import("../../../site.config")>();
  return {
    ...configModule,
    default: {
      ...configModule.default,
      acquisition: {
        ...configModule.default.acquisition,
        attribution: { enabled: true },
        referrals: { enabled: true },
      },
    },
  };
});
vi.mock("./store", () => ({ createAttributionStore: () => ({ freeze }) }));
vi.mock("./referrals/service", () => ({
  createReferralService: () => ({ bind }),
}));
vi.mock("@/core/email", () => ({ sendEmail: send }));
vi.mock("@/core/observability/track-server", () => ({ trackServer: track }));
vi.mock("@/core/lib/after-response", () => ({
  runAfterResponse: (run: () => Promise<void>) => run(),
}));
import { auth } from "@/core/auth/server";
import { env } from "@/core/env";

const hook = auth.options.databaseHooks!.user!.create!.after!;
beforeEach(() => vi.clearAllMocks());
describe("configured Better Auth creation hook", () => {
  test.each(["/sign-in/email-otp", "/callback/google", "/one-tap/callback"])(
    "freezes source and retains existing notifications for %s",
    async (path) => {
      const snapshot = captureEntry(
        { pathname: "/", utm_source: "launch" },
        "site.test",
      )!;
      const headers = new Headers({
        cookie: `${SOURCE_COOKIE}=${signContext({ v: 1, purpose: "source", attribution: snapshot }, env.BETTER_AUTH_SECRET)}`,
      });
      // Endpoint fixture: only fields consumed by the configured database hook.
      const context = {
        path,
        headers,
        request: new Request(`http://localhost:3000/api/auth${path}`, {
          headers,
        }),
        setCookie: vi.fn(),
      } as unknown as NonNullable<Parameters<typeof hook>[1]>;
      await hook(
        {
          id: "new-user",
          name: "Test",
          email: "test@example.com",
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        context,
      );
      expect(freeze).toHaveBeenCalledWith(
        "new-user",
        snapshot,
        expect.any(Number),
      );
      expect(send).toHaveBeenCalledOnce();
      expect(track).toHaveBeenCalledOnce();
    },
  );
  test("registration binds the referral code carried in the signed cookie", async () => {
    bind.mockResolvedValue({ ok: true, inviterUserId: "inviter" });
    const code = newReferralCode();
    const snapshot = captureEntry(
      { pathname: "/invite", utm_source: "launch" },
      "site.test",
    )!;
    const headers = new Headers({
      cookie: [
        `${SOURCE_COOKIE}=${signContext({ v: 1, purpose: "source", attribution: snapshot }, env.BETTER_AUTH_SECRET)}`,
        `${REFERRAL_COOKIE}=${signContext({ v: 1, purpose: "referral", code, acceptedAt: Date.now() }, env.BETTER_AUTH_SECRET)}`,
      ].join("; "),
    });
    const context = {
      path: "/sign-in/email-otp",
      headers,
      request: new Request("http://localhost:3000/api/auth/sign-in/email-otp", {
        headers,
      }),
      setCookie: vi.fn(),
    } as unknown as NonNullable<Parameters<typeof hook>[1]>;
    await hook(
      {
        id: "new-user",
        name: "Test",
        email: "test@example.com",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      context,
    );
    // The sign-up identity comes from the server; the inviter isn't in the request, only in the
    // cookie's code.
    expect(bind).toHaveBeenCalledWith({ inviteeUserId: "new-user", code });
    // The two contexts stay separate: UTM attribution is stored as usual and not overwritten by the
    // invite.
    expect(freeze).toHaveBeenCalledWith(
      "new-user",
      snapshot,
      expect.any(Number),
    );
  });

  test("writes no relationship without a referral context", async () => {
    const headers = new Headers();
    await hook(
      {
        id: "new-user",
        name: "Test",
        email: "test@example.com",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        path: "/sign-in/email-otp",
        headers,
        request: new Request(
          "http://localhost:3000/api/auth/sign-in/email-otp",
          {
            headers,
          },
        ),
        setCookie: vi.fn(),
      } as unknown as NonNullable<Parameters<typeof hook>[1]>,
    );
    expect(bind).not.toHaveBeenCalled();
  });

  test("existing-user session creation does not freeze attribution", async () => {
    const onSession = auth.options.databaseHooks!.session!.create!.after!;
    const context = {
      headers: new Headers(),
      context: {
        internalAdapter: { findUserById: vi.fn().mockResolvedValue(null) },
      },
    } as unknown as NonNullable<Parameters<typeof onSession>[1]>;
    await onSession(
      {
        id: "session",
        userId: "old-user",
        token: "test-token",
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000),
      },
      context,
    );
    expect(freeze).not.toHaveBeenCalled();
  });
});
