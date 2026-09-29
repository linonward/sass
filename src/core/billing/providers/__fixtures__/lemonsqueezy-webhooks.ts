// Lemon Squeezy webhook request body samples, stored in lemonsqueezy-webhooks.json next to this
// file: order_created and three others are copied verbatim from
// https://docs.lemonsqueezy.com/help/webhooks/example-payloads (fetched 2026-09-28); the rest are
// built from the field tables on the object pages. The `$comment` at the top of the JSON records
// the sources and how each sample was built.
import samples from "./lemonsqueezy-webhooks.json";

/** `$comment` is a source note for human readers, not an event. */
export type LemonSqueezySampleEvent = Exclude<keyof typeof samples, "$comment">;

type SampleWebhook = {
  meta: Record<string, unknown> & { event_name: string };
  data: Record<string, unknown> & {
    id: string | number;
    attributes: Record<string, unknown> & { first_order_item?: unknown };
  };
};

/**
 * Deep-copies a sample so tests can mutate it freely (inject meta.custom_data, swap variant_id,
 * etc.).
 */
export function lemonSqueezySample(event: LemonSqueezySampleEvent) {
  return structuredClone(samples[event]) as SampleWebhook;
}
