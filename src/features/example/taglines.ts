import { z } from "zod";

import type { RunAIInput, RunAIResult } from "@/core/ai";
import { InsufficientCreditsError, type Credits } from "@/core/credits";

// Example business module: write taglines for a product. It shows how business code charges
// credits:
// - "Quick generate" is the business's own charge: deductCredits takes QUICK_COST.
// - "AI generate" goes through runAI, which reserves the model's creditCost from site.config.ts up
//   front and refunds automatically on failure.
// This file doesn't depend on Next, which keeps it unit-testable; ./actions.ts binds the real
// dependencies.

/** Credits deducted per quick generation. */
export const QUICK_COST = 1;

/** Source name for quick generation in credit transactions; sourceId is each submit's request ID. */
export const QUICK_CREDIT_SOURCE = "example-taglines";

export const productSchema = z.string().trim().min(3).max(200);

export type GenerateError =
  | "invalid"
  | "unauthorized"
  | "insufficient_credits"
  | "rate_limited"
  | "ai_unavailable"
  | "failed";

export type GenerateResult =
  { ok: true; taglines: string[] } | { ok: false; error: GenerateError };

/** Template generation without calling a model: deterministic output, good for demos and tests. */
export function quickTaglines(product: string): string[] {
  const name = product.trim();
  return [
    `${name}, without the busywork.`,
    `Meet ${name}: built for people who ship.`,
    `${name} — do more before lunch.`,
  ];
}

export function taglinePrompt(product: string) {
  return `Write 3 short, punchy marketing taglines for this product: ${product.trim()}
Reply with one tagline per line, no numbering, no quotes.`;
}

/** Split the model's reply into at most 3 taglines, stripping numbering, bullets and quotes. */
export function parseTaglines(text: string): string[] {
  return text
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^(\d+[.)]|[-*•])\s*/, "")
        .replace(/^["“']|["”']$/g, "")
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 3);
}

/**
 * Quick generation: deduct credits first, then do the work. A given requestId is charged only once
 * (resubmits, double clicks); with an insufficient balance nothing is deducted and it returns
 * insufficient_credits.
 */
export async function generateQuick(
  deps: { deductCredits: Credits["deductCredits"] },
  input: { userId: string; product: string; requestId: string },
): Promise<GenerateResult> {
  try {
    await deps.deductCredits({
      userId: input.userId,
      amount: QUICK_COST,
      source: QUICK_CREDIT_SOURCE,
      sourceId: input.requestId,
      reason: "Quick taglines",
    });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return { ok: false, error: "insufficient_credits" };
    }
    throw error;
  }
  return { ok: true, taglines: quickTaglines(input.product) };
}

const aiErrors: Record<number, GenerateError> = {
  401: "unauthorized",
  402: "insufficient_credits",
  429: "rate_limited",
  503: "ai_unavailable",
};

/**
 * AI generation: runAI handles the sign-in check, rate limiting, reserving credits per model and
 * refunding on failure; business code only deals with the prompt and the result. `after` makes
 * sure bookkeeping (ai_usage, refunds) still completes after the response is sent.
 */
export async function generateWithAI(
  deps: {
    runAI: (input: RunAIInput) => Promise<RunAIResult>;
    after: (task: () => Promise<unknown>) => void;
  },
  input: { userId: string; ip: string | null; product: string },
): Promise<GenerateResult> {
  const run = await deps.runAI({
    userId: input.userId,
    ip: input.ip,
    prompt: taglinePrompt(input.product),
  });
  if (!run.ok) return { ok: false, error: aiErrors[run.status] ?? "failed" };
  deps.after(() => run.settled);

  try {
    const taglines = parseTaglines(await run.result.text);
    return taglines.length > 0
      ? { ok: true, taglines }
      : { ok: false, error: "failed" };
  } catch {
    // When the model errors, runAI has already refunded the credits.
    return { ok: false, error: "failed" };
  }
}
