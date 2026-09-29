import { logger } from "@/core/observability/logger";

/** User info passed to each hook when an account is deleted. */
export type DeletedUser = { userId: string; email: string };

export type OnUserDeleteHandler = (user: DeletedUser) => Promise<void> | void;

const handlers = new Map<string, OnUserDeleteHandler>();

/**
 * Register cleanup logic to run before an account is deleted, such as canceling subscriptions or
 * deleting uploaded files. Hooks run in registration order; registering the same name again
 * replaces the previous one (so hot module reloads don't make it run twice). Import the
 * registration file in ./hooks.ts so every module is registered by the time a deletion runs.
 */
export function registerOnUserDelete(
  name: string,
  handler: OnUserDeleteHandler,
) {
  handlers.delete(name);
  handlers.set(name, handler);
}

/** Names of the registered hooks, in execution order. */
export function onUserDeleteHandlers(): string[] {
  return [...handlers.keys()];
}

/** Test-only: clear the registry. */
export function resetOnUserDelete() {
  handlers.clear();
}

/** Thrown when a hook fails; the deletion is aborted and the user's data is left untouched. */
export class OnUserDeleteError extends Error {
  constructor(
    readonly handler: string,
    override readonly cause: unknown,
  ) {
    super(`onUserDelete handler "${handler}" failed`);
    this.name = "OnUserDeleteError";
  }
}

/**
 * Run all hooks in order. Stop at the first failure, skip the remaining hooks, and throw
 * OnUserDeleteError. Call this before deleting the user: hooks can still read the user's data, and
 * if external resources (such as subscriptions) weren't fully cleaned up, the account is not
 * deleted — so a user is never deleted while still being charged.
 */
export async function runOnUserDelete(user: DeletedUser) {
  for (const [name, handler] of handlers) {
    try {
      await handler(user);
    } catch (error) {
      logger.error("account.on_user_delete_failed", {
        error,
        handler: name,
        userId: user.userId,
      });
      throw new OnUserDeleteError(name, error);
    }
  }
}
