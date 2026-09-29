// Webhook request bodies assembled from the example objects in the official Stripe API docs (not
// captures of real deliveries). Copied on 2026-09-28 from the pages below; field names follow the
// type definitions bundled with stripe-node 22.6.2 (apiVersion 2026-08-26.dahlia):
// - Checkout Session: https://docs.stripe.com/api/checkout/sessions/object
// - Subscription: https://docs.stripe.com/api/subscriptions/object
// - Invoice: https://docs.stripe.com/api/invoices/object
// - Invoice Line Item: https://docs.stripe.com/api/invoices/line_item
// - Event envelope: https://docs.stripe.com/api/events/object
// Each entry is a complete event (including data.object); IDs and amounts are the values from the
// doc examples. Re-copy them when the docs change; tests must not depend on the specific IDs.
import samples from "./stripe-webhooks.json";

export type StripeSampleEvent = keyof typeof samples;

type StripeSample = {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
};

/**
 * Deep-copies a sample so tests can mutate it freely (change metadata or status, delete fields).
 */
export function stripeSample(event: StripeSampleEvent) {
  return structuredClone(samples[event]) as StripeSample;
}
