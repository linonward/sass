"use server";

import { randomUUID } from "node:crypto";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";

import { aiEnabled, runAI } from "@/core/ai";
import { getSession } from "@/core/auth/session";
import { creditsEnabled, deductCredits } from "@/core/credits";
import { getClientIp } from "@/core/ratelimit";

import {
  generateQuick,
  generateWithAI,
  productSchema,
  type GenerateResult,
} from "./taglines";

export type TaglineState =
  | { status: "idle" }
  | (GenerateResult & {
      status: "done";
      nextRequestId: string;
      // 表单提交后 React 会重置输入框，带回去作为默认值。
      product: string;
    });

/** 表单提交：按 mode 选择快速生成（deductCredits）或 AI 生成（runAI）。 */
export async function generateTaglines(
  _prev: TaglineState,
  form: FormData,
): Promise<TaglineState> {
  const done = (result: GenerateResult): TaglineState => ({
    ...result,
    status: "done",
    product: String(form.get("product") ?? ""),
    // 下一次提交用新的请求 ID；同一个 ID 重复提交只扣一次积分。
    nextRequestId: randomUUID(),
  });

  const session = await getSession();
  if (!session) return done({ ok: false, error: "unauthorized" });
  const product = productSchema.safeParse(form.get("product"));
  if (!product.success) return done({ ok: false, error: "invalid" });
  if (!creditsEnabled) return done({ ok: false, error: "failed" });

  const userId = session.user.id;
  const result =
    form.get("mode") === "ai"
      ? aiEnabled
        ? await generateWithAI(
            { runAI, after },
            {
              userId,
              ip: getClientIp(await headers()),
              product: product.data,
            },
          )
        : { ok: false as const, error: "ai_unavailable" as const }
      : await generateQuick(
          { deductCredits },
          {
            userId,
            product: product.data,
            requestId: String(form.get("requestId") ?? randomUUID()),
          },
        );

  // 页面上的余额要跟着变。
  refresh();
  return done(result);
}
