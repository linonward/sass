import { track as vercelTrack } from "@vercel/analytics";

import type { TrackEventName, TrackProperties } from "./events";

/**
 * Records a conversion event in the browser. A no-op when <Analytics /> isn't mounted
 * (observability.analytics off), so callers don't need to check the flag. On the server, use
 * trackServer from ./track-server.ts.
 */
export function track(name: TrackEventName, properties?: TrackProperties) {
  if (typeof window === "undefined" || !window.va) return;
  try {
    vercelTrack(name, properties);
  } catch {
    // An analytics failure must not affect the product flow.
  }
}
