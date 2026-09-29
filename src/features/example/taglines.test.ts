import { describe, expect, test, vi } from "vitest";

import type { RunAIResult } from "@/core/ai";
import { InsufficientCreditsError } from "@/core/credits";

import {
  generateQuick,
  generateWithAI,
  parseTaglines,
  QUICK_COST,
  QUICK_CREDIT_SOURCE,
} from "./taglines";

describe("quick generation (deductCredits)", () => {
  test("deducts QUICK_COST credits by request ID, then returns 3 taglines", async () => {
    const deductCredits = vi.fn().mockResolvedValue({});
    const result = await generateQuick(
      { deductCredits },
      { userId: "u1", product: " Acme Invoices ", requestId: "req-1" },
    );

    expect(deductCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        amount: QUICK_COST,
        source: QUICK_CREDIT_SOURCE,
        sourceId: "req-1",
      }),
    );
    expect(result).toEqual({
      ok: true,
      taglines: expect.arrayContaining([
        "Acme Invoices, without the busywork.",
      ]),
    });
  });

  test("returns insufficient_credits when the balance is too low", async () => {
    const deductCredits = vi
      .fn()
      .mockRejectedValue(new InsufficientCreditsError("u1", QUICK_COST));
    expect(
      await generateQuick(
        { deductCredits },
        { userId: "u1", product: "Acme", requestId: "req-1" },
      ),
    ).toEqual({ ok: false, error: "insufficient_credits" });
  });
});

describe("AI generation (runAI)", () => {
  function success(text: Promise<string>): RunAIResult {
    return {
      ok: true,
      usageId: "usage-1",
      model: { id: "fast", provider: "anthropic", model: "m", creditCost: 1 },
      result: { text } as never,
      settled: Promise.resolve("succeeded"),
    } as RunAIResult;
  }

  test("parses the model reply and hands bookkeeping to after", async () => {
    const runAI = vi
      .fn()
      .mockResolvedValue(
        success(Promise.resolve('1. One\n- Two\n"Three"\nFour')),
      );
    const after = vi.fn();
    const result = await generateWithAI(
      { runAI, after },
      { userId: "u1", ip: "1.2.3.4", product: "Acme" },
    );

    expect(runAI).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", ip: "1.2.3.4" }),
    );
    expect(after).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true, taglines: ["One", "Two", "Three"] });
  });

  test.each([
    [401, "unauthorized"],
    [402, "insufficient_credits"],
    [429, "rate_limited"],
    [503, "ai_unavailable"],
    [400, "failed"],
  ] as const)("runAI returning %i reports %s", async (status, error) => {
    const runAI = vi.fn().mockResolvedValue({
      ok: false,
      status,
      response: new Response(null, { status }),
    });
    expect(
      await generateWithAI(
        { runAI, after: vi.fn() },
        { userId: "u1", ip: null, product: "Acme" },
      ),
    ).toEqual({ ok: false, error });
  });

  test("returns failed when the model errors (runAI handles the refund)", async () => {
    const runAI = vi
      .fn()
      .mockResolvedValue(success(Promise.reject(new Error("boom"))));
    expect(
      await generateWithAI(
        { runAI, after: vi.fn() },
        { userId: "u1", ip: null, product: "Acme" },
      ),
    ).toEqual({ ok: false, error: "failed" });
  });
});

test("parseTaglines strips numbering and quotes, keeping at most 3", () => {
  expect(parseTaglines("\n1) “Alpha”\n* Beta\n\n3. Gamma\n4. Delta")).toEqual([
    "Alpha",
    "Beta",
    "Gamma",
  ]);
});
