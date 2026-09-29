"use client";

import { useEffect } from "react";

import { identifyUser } from "./sentry";

/**
 * Hands the signed-in user's ID to browser-side Sentry (only the ID is sent); does nothing when
 * Sentry is off.
 * Doesn't clear it on unmount: when rendering fails, the error boundary unmounts the outer shell
 * before reporting the error, so clearing it would drop the user from that very report.
 */
export function IdentifyUser({ userId }: { userId: string }) {
  useEffect(() => identifyUser(userId), [userId]);
  return null;
}
