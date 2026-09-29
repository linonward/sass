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
    });

/** Form submit: depending on mode, do a quick generation (deductCredits) or an AI generation (runAI). */
export async function generateTaglines(
  _prev: TaglineState,
  form: FormData,
): Promise<TaglineState> {
  const done = (result: GenerateResult): TaglineState => ({
    ...result,
    status: "done",
    // The next submit uses a new request ID; resubmitting the same ID deducts credits only once.
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

  // The balance shown on the page needs to update too.
  refresh();
  return done(result);
}
