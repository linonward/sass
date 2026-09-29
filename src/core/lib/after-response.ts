import { after } from "next/server";

/**
 * Runs `task` after the response has been sent (Next's `after`; on Vercel, waitUntil guarantees it
 * runs to completion). Meant for side effects such as sending email that don't affect the result
 * and only get logged on failure.
 * Outside a request scope (tests, scripts) `after` throws; in that case the task runs directly and
 * is awaited. The task handles its own errors.
 */
export async function runAfterResponse(task: () => Promise<void>) {
  try {
    after(task);
    return;
  } catch {
    // Not inside a request scope.
  }
  await task();
}
