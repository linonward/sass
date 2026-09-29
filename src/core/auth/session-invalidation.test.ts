import { describe, expect, test, vi } from "vitest";

import {
  EMAIL_CHANGE_PATH,
  emailChangeSucceeded,
  revokeSessionsOnEmailChange,
} from "./session-invalidation";

type FakeCtx = {
  path?: string;
  context: {
    returned?: unknown;
    session?: { user: { id: string } } | null;
    internalAdapter: { deleteUserSessions: () => Promise<void> };
  };
};

/** Get the after hook the plugin registers, and feed it a ctx shaped like the real one. */
function afterHook() {
  const hook = revokeSessionsOnEmailChange().hooks?.after?.[0];
  if (!hook) throw new Error("plugin registered no after hook");
  return hook as unknown as {
    matcher: (ctx: FakeCtx) => boolean;
    handler: (ctx: FakeCtx) => Promise<unknown>;
  };
}

function run({
  path = EMAIL_CHANGE_PATH,
  returned,
  userId = "user-1",
}: {
  path?: string;
  returned?: unknown;
  userId?: string | null;
}) {
  const deleteUserSessions = vi.fn(async () => {});
  const ctx: FakeCtx = {
    path,
    context: {
      returned,
      session: userId ? { user: { id: userId } } : null,
      internalAdapter: { deleteUserSessions },
    },
  };
  const hook = afterHook();
  const matched = hook.matcher(ctx);
  return (async () => {
    if (matched) await hook.handler(ctx);
    return deleteUserSessions;
  })();
}

describe("emailChangeSucceeded", () => {
  test("looks only at the endpoint's success field", () => {
    expect(emailChangeSucceeded({ success: true })).toBe(true);
    expect(emailChangeSucceeded({ success: false })).toBe(false);
    // The after hook still runs when the endpoint fails; returned is then an APIError or undefined.
    expect(emailChangeSucceeded(undefined)).toBe(false);
    expect(emailChangeSucceeded(new Error("boom"))).toBe(false);
    expect(emailChangeSucceeded(null)).toBe(false);
  });
});

describe("revokeSessionsOnEmailChange", () => {
  test("revokes all of the user's sessions only after the change-email endpoint succeeds", async () => {
    const deleteUserSessions = await run({ returned: { success: true } });
    expect(deleteUserSessions).toHaveBeenCalledTimes(1);
    expect(deleteUserSessions).toHaveBeenCalledWith("user-1");
  });

  test("leaves sessions alone when the endpoint fails", async () => {
    // A wrong verification code, a new email that's already taken, and so on all end up here; the
    // email didn't change, so sessions must not be kicked out.
    expect(await run({ returned: { success: false } })).not.toHaveBeenCalled();
    expect(await run({ returned: undefined })).not.toHaveBeenCalled();
  });

  test("other endpoints are unaffected", async () => {
    // Endpoints such as sign-in and sending a code also return { success: true }; the path is
    // what excludes them.
    expect(
      await run({
        path: "/email-otp/send-verification-otp",
        returned: { success: true },
      }),
    ).not.toHaveBeenCalled();
  });

  test("does nothing when there is no session", async () => {
    expect(
      await run({ returned: { success: true }, userId: null }),
    ).not.toHaveBeenCalled();
  });
});
