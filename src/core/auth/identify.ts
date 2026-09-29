import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";

import { identifyUser } from "@/core/observability/sentry";

/** Extract the user ID from get-session's return value; null when signed out or when it's a Response. */
export function sessionUserId(returned: unknown): string | null {
  if (typeof returned !== "object" || returned === null) return null;
  const user = (returned as { user?: { id?: unknown } }).user;
  return typeof user?.id === "string" ? user.id : null;
}

/**
 * After every session read (auth.api.getSession in pages, Server Actions, and APIs), pass the user
 * ID to the current request's Sentry scope so every error reported later in that request carries
 * the user ID. Does nothing when Sentry is not enabled.
 */
export function identifySessionUser() {
  return {
    id: "identify-session-user",
    hooks: {
      after: [
        {
          matcher: (context) => context.path === "/get-session",
          handler: createAuthMiddleware(async (ctx) => {
            identifyUser(sessionUserId(ctx.context.returned));
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
