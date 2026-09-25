import { track as vercelTrack } from "@vercel/analytics";

import type { TrackEventName, TrackProperties } from "./events";

/**
 * 在浏览器里记一个转化事件。<Analytics /> 没有挂载（observability.analytics 关闭）时为空操作，
 * 所以调用方不用判断开关。服务端用 ./track-server.ts 的 trackServer。
 */
export function track(name: TrackEventName, properties?: TrackProperties) {
  if (typeof window === "undefined" || !window.va) return;
  try {
    vercelTrack(name, properties);
  } catch {
    // 统计失败不影响业务流程。
  }
}
