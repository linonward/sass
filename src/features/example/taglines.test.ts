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

describe("快速生成（deductCredits）", () => {
  test("按请求 ID 扣 QUICK_COST 积分后返回 3 条", async () => {
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

  test("余额不足时返回 insufficient_credits", async () => {
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

describe("AI 生成（runAI）", () => {
  function success(text: Promise<string>): RunAIResult {
    return {
      ok: true,
      usageId: "usage-1",
      model: { id: "fast", provider: "anthropic", model: "m", creditCost: 1 },
      result: { text } as never,
      settled: Promise.resolve("succeeded"),
    } as RunAIResult;
  }

  test("解析模型回复，并把记账交给 after", async () => {
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
  ] as const)("runAI 返回 %i 时报 %s", async (status, error) => {
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

  test("模型报错时返回 failed（runAI 负责退款）", async () => {
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

test("parseTaglines 去掉序号和引号，最多 3 条", () => {
  expect(parseTaglines("\n1) “Alpha”\n* Beta\n\n3. Gamma\n4. Delta")).toEqual([
    "Alpha",
    "Beta",
    "Gamma",
  ]);
});
