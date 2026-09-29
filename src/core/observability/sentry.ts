import type * as SentryNext from "@sentry/nextjs";

import type { ErrorReporter, LogFields } from "./logger";

// Types only, no SDK import here: when Sentry is off, @sentry/nextjs is neither bundled nor loaded.
// sentry.server.ts / sentry.edge.ts / sentry.client.ts initialize the SDK and register it here.
export type SentryApi = Pick<
  typeof SentryNext,
  "captureException" | "setUser" | "withScope"
>;

// Stored on globalThis: instrumentation and the per-route bundles don't necessarily share module
// instances (Sentry does the same).
const KEY = Symbol.for("app.observability.sentry");
type Holder = {
  [KEY]?: { api?: SentryApi; pendingUserId?: string | null };
};

function holder() {
  return ((globalThis as Holder)[KEY] ??= {});
}

function current() {
  return holder().api;
}

/** Call once initialization finishes; pass undefined to unregister (for tests). */
export function registerSentry(api: SentryApi | undefined) {
  const state = holder();
  state.api = api;
  // The browser SDK is loaded dynamically, so the page may have called identifyUser first; apply
  // it now.
  if (api && state.pendingUserId !== undefined) {
    api.setUser(state.pendingUserId ? { id: state.pendingUserId } : null);
  }
  state.pendingUserId = undefined;
}

/**
 * The shared part of the Sentry init options. By default the SDK collects cookies, request
 * headers, query strings, request bodies, AI inputs and outputs, database parameters, and local
 * variables in stack frames; all of that is turned off here. The user is set only through
 * identifyUser, as an ID, with no automatic IP address or email.
 */
export function sentryBaseOptions({
  dsn,
  environment,
}: {
  dsn: string | undefined;
  environment: string | undefined;
}) {
  return {
    dsn,
    environment,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: { allow: ["user-agent", "referer", "content-type"] },
        response: false,
      },
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
  } satisfies Parameters<typeof SentryNext.init>[0];
}

/**
 * Reporter for logger.error: the event name becomes a tag, the remaining (already redacted)
 * fields become extras, and a userId field sets the user.
 * When there's no Error, one is created from the event name so Sentry can group by event.
 */
export const reportToSentry: ErrorReporter = (error, event, fields) => {
  const sentry = current();
  if (!sentry) return;
  sentry.withScope((scope) => {
    scope.setTag("event", event);
    // error is already reported as the exception itself; don't duplicate it in extras.
    const { userId, ...extra } = fields as LogFields;
    delete extra.error;
    if (typeof userId === "string") scope.setUser({ id: userId });
    scope.setExtras(extra);
    sentry.captureException(error ?? new Error(event));
  });
};

/** The signed-in user of the current request (server) or page (browser); only the ID is sent. */
export function identifyUser(userId: string | null | undefined) {
  const api = current();
  if (api) api.setUser(userId ? { id: userId } : null);
  // Only buffer in the browser: the server SDK is registered at startup, and a buffered user would
  // leak into other requests.
  else if (typeof window !== "undefined")
    holder().pendingUserId = userId ?? null;
}

/** Used by the client error boundaries (error.tsx / global-error.tsx). */
export function captureError(error: unknown) {
  current()?.captureException(error);
}
