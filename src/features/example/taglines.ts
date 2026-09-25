import { z } from "zod";

import type { RunAIInput, RunAIResult } from "@/core/ai";
import { InsufficientCreditsError, type Credits } from "@/core/credits";

// 示例业务模块：给产品写宣传语。演示业务代码怎么收积分：
// - 「快速生成」是业务自己的收费，用 deductCredits 扣 QUICK_COST；
// - 「AI 生成」交给 runAI，它按 site.config.ts 里模型的 creditCost 预扣，失败自动退回。
// 这个文件不依赖 Next，便于单测；绑定真实依赖的是 ./actions.ts。

/** 快速生成每次扣的积分。 */
export const QUICK_COST = 1;

/** 快速生成在积分流水里的来源名；sourceId 是每次提交的请求 ID。 */
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

/** 不调用模型的模板生成：结果固定，适合演示和测试。 */
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

/** 把模型的回复拆成最多 3 条：去掉序号、项目符号和引号。 */
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
 * 快速生成：先扣积分再干活。同一个 requestId 只扣一次（重复提交、双击），
 * 余额不足时一分不扣，返回 insufficient_credits。
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
 * AI 生成：runAI 负责登录检查、限流、按模型预扣积分和失败退款，业务只管提示词和结果。
 * `after` 保证响应返回后记账（ai_usage、退款）还能跑完。
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
    // 模型报错时 runAI 已经退回积分。
    return { ok: false, error: "failed" };
  }
}
