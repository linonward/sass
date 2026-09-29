import { describe, expect, test, vi } from "vitest";

import { RESEND_COOLDOWN } from "./errors";
import {
  cooldownIdentifier,
  otpResendCooldown,
  remainingCooldown,
} from "./cooldown";

describe("remainingCooldown", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  test("is 0 when there is no record or it has expired", () => {
    expect(remainingCooldown(undefined, now)).toBe(0);
    expect(remainingCooldown(new Date("2025-12-31T23:59:59Z"), now)).toBe(0);
  });

  test("rounds up to whole seconds during the cooldown", () => {
    expect(remainingCooldown(new Date("2026-01-01T00:00:59.200Z"), now)).toBe(
      60,
    );
    expect(remainingCooldown(new Date("2026-01-01T00:00:01Z"), now)).toBe(1);
  });

  test("edge: exactly expired is 0, and less than a second counts as one second", () => {
    expect(remainingCooldown(new Date("2026-01-01T00:00:00.000Z"), now)).toBe(
      0,
    );
    // With 0.5 seconds left it must not be 0; otherwise the user could resend before the cooldown
    // ends.
    expect(remainingCooldown(new Date("2026-01-01T00:00:00.500Z"), now)).toBe(
      1,
    );
    expect(remainingCooldown(new Date("2026-01-01T00:00:00.001Z"), now)).toBe(
      1,
    );
  });

  test("edge: long cooldowns don't overflow or turn fractional", () => {
    const remaining = remainingCooldown(new Date("2026-01-02T00:00:00Z"), now);
    expect(remaining).toBe(24 * 60 * 60);
    expect(Number.isInteger(remaining)).toBe(true);
  });
});

test("cooldown records are keyed by normalized email and distinct from verification code records", () => {
  expect(cooldownIdentifier(" Ada@Example.com ")).toBe(
    "otp-resend-cooldown:ada@example.com",
  );
});

test("the cooldown identifier never overlaps the emailOTP plugin's <type>-otp-<email>", () => {
  const identifier = cooldownIdentifier("ada@example.com");
  for (const type of ["sign-in", "change-email", "email-verification"]) {
    expect(identifier).not.toBe(`${type}-otp-ada@example.com`);
  }
  expect(identifier.startsWith("otp-resend-cooldown:")).toBe(true);
});

/** The send endpoint's before-hook: call the handler directly, skipping better-auth's middleware wiring. */
function sendHook({
  seconds = 60,
  now,
}: { seconds?: number; now?: Date } = {}) {
  const plugin = otpResendCooldown({
    seconds,
    now: () => now ?? new Date("2026-01-01T00:00:00Z"),
  });
  const [hook] = (
    plugin.hooks as { before: { matcher: unknown; handler: unknown }[] }
  ).before;
  return hook!.handler as (ctx: unknown) => Promise<unknown>;
}

function sendPathMatcher() {
  const plugin = otpResendCooldown({ seconds: 60 });
  const [hook] = (
    plugin.hooks as { before: { matcher: unknown; handler: unknown }[] }
  ).before;
  return hook!.matcher as (ctx: { path: string }) => boolean;
}

function adapter(existing: { expiresAt: Date } | undefined) {
  const created: { identifier: string; expiresAt: Date }[] = [];
  const deleted: string[] = [];
  return {
    created,
    deleted,
    context: {
      internalAdapter: {
        findVerificationValue: async () => existing,
        deleteVerificationByIdentifier: async (identifier: string) => {
          deleted.push(identifier);
        },
        createVerificationValue: async (value: {
          identifier: string;
          expiresAt: Date;
        }) => {
          created.push(value);
        },
      },
    },
  };
}

describe("otpResendCooldown", () => {
  const send = {
    path: "/email-otp/send-verification-otp",
    body: { email: "ada@example.com" },
  };

  test("only intercepts the send endpoint", () => {
    const matches = sendPathMatcher();
    expect(matches({ path: "/email-otp/send-verification-otp" })).toBe(true);
    expect(matches({ path: "/sign-in/email-otp" })).toBe(false);
    expect(matches({ path: "/get-session" })).toBe(false);
  });

  test("lets the request through and writes a record when there is no cooldown record", async () => {
    const store = adapter(undefined);
    await sendHook()({ ...send, context: store.context });

    expect(store.deleted).toEqual([]);
    expect(store.created).toHaveLength(1);
    expect(store.created[0]!.identifier).toBe(
      "otp-resend-cooldown:ada@example.com",
    );
    // The record's expiry is the cooldown window.
    expect(store.created[0]!.expiresAt).toEqual(
      new Date("2026-01-01T00:01:00Z"),
    );
  });

  test("throws TOO_MANY_REQUESTS with Retry-After during the cooldown", async () => {
    const store = adapter({ expiresAt: new Date("2026-01-01T00:00:30Z") });
    const error = await sendHook()({ ...send, context: store.context }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toMatchObject({
      status: "TOO_MANY_REQUESTS",
      body: {
        code: RESEND_COOLDOWN,
        message: "Please wait 30s before requesting a new code",
        retryAfter: 30,
      },
      // The client reads Retry-After to show a countdown.
      headers: { "Retry-After": "30" },
    });
    // Write nothing when blocked: the cooldown window must not be extended.
    expect(store.created).toEqual([]);
    expect(store.deleted).toEqual([]);
  });

  test("deletes the old record and writes a new one once expired (expired is not a cooldown)", async () => {
    const store = adapter({ expiresAt: new Date("2025-12-31T23:59:00Z") });
    await sendHook()({ ...send, context: store.context });

    expect(store.deleted).toEqual(["otp-resend-cooldown:ada@example.com"]);
    expect(store.created).toHaveLength(1);
  });

  test("lets the request through when email is not a string (tampered body)", async () => {
    const store = adapter(undefined);
    await sendHook()({
      path: send.path,
      body: { email: 123 },
      context: store.context,
    });
    expect(store.created).toEqual([]);
    expect(store.deleted).toEqual([]);
  });

  test("lets the request through when there is no body", async () => {
    const store = adapter(undefined);
    await sendHook()({
      path: send.path,
      body: undefined,
      context: store.context,
    });
    expect(store.created).toEqual([]);
  });

  test("does nothing when seconds <= 0 (configuring 0 disables the cooldown)", async () => {
    const create = vi.fn();
    const store = adapter(undefined);
    await sendHook({ seconds: 0 })({
      ...send,
      context: {
        internalAdapter: {
          ...store.context.internalAdapter,
          createVerificationValue: create,
        },
      },
    });
    expect(create).not.toHaveBeenCalled();
  });

  test("uses the normalized email as the key, so case and whitespace don't matter", async () => {
    const store = adapter({ expiresAt: new Date("2026-01-01T00:00:30Z") });
    await expect(
      sendHook()({
        path: send.path,
        body: { email: " ADA@example.COM " },
        context: store.context,
      }),
    ).rejects.toMatchObject({ body: { code: RESEND_COOLDOWN } });
  });
});
