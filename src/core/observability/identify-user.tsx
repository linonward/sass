"use client";

import { useEffect } from "react";

import { identifyUser } from "./sentry";

/**
 * 把登录用户的 ID 交给浏览器端的 Sentry（只发 ID）；没开 Sentry 时什么也不做。
 * 卸载时不清空：渲染出错时错误边界会先卸载外框，再上报错误，清空会让这次上报丢掉用户。
 */
export function IdentifyUser({ userId }: { userId: string }) {
  useEffect(() => identifyUser(userId), [userId]);
  return null;
}
