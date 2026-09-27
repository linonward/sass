import type { Attribution } from "./context";
import {
  cookieOptions,
  RETRY_COOKIE,
  RETRY_SECONDS,
  signContext,
  sourceFromHeaders,
} from "./tokens";

type Dependencies = {
  enabled: boolean;
  secret: string;
  freeze: (
    userId: string,
    snapshot: Attribution,
    registeredAt: number,
  ) => Promise<void>;
  warn: (event: string, fields: { userId: string }) => void;
};
type CookieWriter = (
  name: string,
  value: string,
  options: typeof cookieOptions & { maxAge: number },
) => unknown;

/** Called only by Better Auth user.create.after, never by a login/session hook. */
export function createRegistrationAttribution(deps: Dependencies) {
  return async (
    userId: string,
    headers?: Headers,
    setCookie?: CookieWriter,
  ) => {
    if (!deps.enabled) return;
    const snapshot = sourceFromHeaders(headers, deps.secret);
    if (!snapshot) return; // unknown is represented by absence, not direct.
    const registeredAt = Date.now();
    try {
      await deps.freeze(userId, snapshot, registeredAt);
    } catch {
      // Keep the exact registration snapshot and identity in an authenticated
      // 24h retry token. The next page POST can retry without creating a user.
      deps.warn("acquisition.freeze_failed", { userId });
      try {
        setCookie?.(
          RETRY_COOKIE,
          signContext(
            {
              v: 1,
              purpose: "registration",
              userId,
              attribution: snapshot,
              registeredAt,
            },
            deps.secret,
          ),
          { ...cookieOptions, maxAge: RETRY_SECONDS },
        );
      } catch {
        deps.warn("acquisition.retry_cookie_failed", { userId });
      }
    }
  };
}
