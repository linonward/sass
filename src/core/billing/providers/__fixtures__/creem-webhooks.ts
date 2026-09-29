// Sample webhook request bodies from the official Creem docs, copied verbatim from
// https://docs.creem.io/code/webhooks (fetched 2026-09-25). Re-copy them when the docs change;
// tests must not depend on the specific IDs in them.
import samples from "./creem-webhooks.json";

export type CreemSampleEvent = keyof typeof samples;

/** Deep-copies a sample so tests can mutate it freely (inject metadata, swap IDs). */
export function creemSample(event: CreemSampleEvent) {
  return structuredClone(samples[event]) as {
    id: string;
    eventType: string;
    created_at: number;
    object: Record<string, unknown> & {
      metadata?: Record<string, unknown>;
    };
  };
}
