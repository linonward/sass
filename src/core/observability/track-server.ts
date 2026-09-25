import { track as vercelTrack } from "@vercel/analytics/server";

import type { TrackEventName, TrackProperties } from "./events";
import { logger } from "./logger";
import { webAnalyticsFlags } from "./web-analytics";

export type TrackServerOptions = {
  /** 访客请求的 headers（用于来源、设备、地区）；不传时用当前请求的。 */
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

/** 可注入的服务端 track，测试里传 send。失败只记日志，不抛错。 */
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
 * 在服务端记一个转化事件（@vercel/analytics/server）。
 * observability.analytics 关闭时为空操作；失败只记 warn，不影响调用方（例如 webhook）。
 */
export const trackServer = createServerTracker({
  enabled: webAnalyticsFlags().analytics,
});
