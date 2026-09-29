import { track as vercelTrack } from "@vercel/analytics/server";

import type { TrackEventName, TrackProperties } from "./events";
import { logger } from "./logger";
import { webAnalyticsFlags } from "./web-analytics";

export type TrackServerOptions = {
  /**
   * Headers of the visitor's request (for referrer, device, and region); defaults to the current
   * request's.
   */
  headers?: Headers | Record<string, string | string[] | undefined>;
};

export type ServerTracker = (
  name: TrackEventName,
  properties?: TrackProperties,
  options?: TrackServerOptions,
) => Promise<void>;

type ServerTrackerDeps = {
  enabled: boolean;
  send?: typeof vercelTrack;
  logWarn?: (event: string, fields: unknown) => void;
};

/** Injectable server-side track; tests pass `send`. Failures are only logged, never thrown. */
export function createServerTracker({
  enabled,
  send = vercelTrack,
  logWarn = logger.warn,
}: ServerTrackerDeps): ServerTracker {
  return async (name, properties, options) => {
    if (!enabled) return;
    try {
      await send(
        name,
        properties,
        options?.headers ? { headers: options.headers } : undefined,
      );
    } catch (error) {
      logWarn("analytics.track_failed", { error, event: name });
    }
  };
}

/**
 * Records a conversion event on the server (@vercel/analytics/server).
 * A no-op when observability.analytics is off. Failures are only logged as warn and don't affect
 * the caller (for example, a webhook).
 */
export const trackServer = createServerTracker({
  enabled: webAnalyticsFlags().analytics,
});
