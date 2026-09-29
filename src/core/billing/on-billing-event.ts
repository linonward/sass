import type { DbTransaction } from "@/core/db";
import { logger } from "@/core/observability/logger";

import type { BillingEvent } from "./events";

export type BillingEventContext = {
  /**
   * Transaction handling this event. All DB writes in hooks must use it, so they commit or roll
   * back with event handling.
   */
  tx: DbTransaction;
  /**
   * A newer state already existed when the event arrived (an old event delivered out of order), so it
   * did not change the subscription or order. The event itself still really happened — e.g. a late
   * renewal should still grant credits — so each hook decides as needed.
   */
  stale: boolean;
  /** Resolved user ID. */
  userId: string;
  /**
   * Register a callback that runs only after the transaction commits, for side effects that can't be
   * undone, such as sending email. It doesn't run if the transaction rolls back (including when a later
   * hook fails); a failing callback is only logged and doesn't affect the webhook result.
   */
  afterCommit: (fn: AfterCommitCallback) => void;
};

export type AfterCommitCallback = () => Promise<void> | void;

export type OnBillingEventHandler = (
  event: BillingEvent,
  context: BillingEventContext,
) => Promise<void> | void;

const handlers = new Map<string, OnBillingEventHandler>();

/**
 * Register follow-up handling for billing events, e.g. granting credits or sending payment-succeeded
 * emails. Each event fires only once (repeated deliveries don't fire again), hooks run in registration
 * order, and registering the same name again replaces the previous one. Import the registration file
 * in ./hooks.ts so every module is registered before events are handled.
 */
export function registerOnBillingEvent(
  name: string,
  handler: OnBillingEventHandler,
) {
  handlers.delete(name);
  handlers.set(name, handler);
}

/** Names of registered hooks, in execution order. */
export function onBillingEventHandlers(): string[] {
  return [...handlers.keys()];
}

/** Test-only: clear the registry. */
export function resetOnBillingEvent() {
  handlers.clear();
}

/**
 * Thrown when a hook fails; the whole event transaction rolls back and the webhook returns 500 so the
 * provider retries.
 */
export class OnBillingEventError extends Error {
  constructor(
    readonly handler: string,
    override readonly cause: unknown,
  ) {
    super(`onBillingEvent handler "${handler}" failed`);
    this.name = "OnBillingEventError";
  }
}

/**
 * Run callbacks registered via afterCommit in order; a failing one is only logged and the rest
 * still run.
 */
export async function runAfterCommit(callbacks: AfterCommitCallback[]) {
  for (const callback of callbacks) {
    try {
      await callback();
    } catch (error) {
      logger.error("billing.after_commit_failed", error);
    }
  }
}

/**
 * Run all hooks in order inside the event transaction; stop and throw OnBillingEventError as soon
 * as one fails.
 */
export async function runOnBillingEvent(
  event: BillingEvent,
  context: BillingEventContext,
) {
  for (const [name, handler] of handlers) {
    try {
      await handler(event, context);
    } catch (error) {
      logger.error("billing.on_billing_event_failed", {
        error,
        handler: name,
        provider: event.provider,
        eventId: event.eventId,
        eventType: event.type,
      });
      throw new OnBillingEventError(name, error);
    }
  }
}
