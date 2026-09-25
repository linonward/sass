import { convertToModelMessages, safeValidateUIMessages } from "ai";

import { getClientIp } from "@/core/ratelimit/limiter";

import type { RunAIInput, RunAIResult } from "./run";

// 请求体上限。按次固定扣费，太长的上下文会让单次成本失控；需要更长时在业务路由里调大。
export const MAX_CHAT_BODY_BYTES = 64 * 1024;

const INSTRUCTIONS = "You are a helpful assistant. Answer concisely.";

export type ChatDeps = {
  enabled: boolean;
  getUserId: (request: Request) => Promise<string | null>;
  runAI: (input: RunAIInput) => Promise<RunAIResult>;
  // 登记响应结束后仍要完成的工作（next/server 的 after）。
  after: (task: () => Promise<unknown>) => void;
};

/**
 * `POST /api/ai/chat` 的处理：body 为 useChat 发来的 `{ messages, modelId? }`，
 * 返回 UI message 流。错误响应是 JSON `{ error }`，前端按 error 显示文案。
 */
export async function handleChat(
  request: Request,
  { enabled, getUserId, runAI, after }: ChatDeps,
): Promise<Response> {
  if (!enabled) return Response.json({ error: "not_found" }, { status: 404 });

  const userId = await getUserId(request);
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_CHAT_BODY_BYTES) {
    return Response.json({ error: "too_large" }, { status: 413 });
  }
  let body: { messages?: unknown; modelId?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const validated = await safeValidateUIMessages({ messages: body?.messages });
  if (!validated.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const run = await runAI({
    userId,
    ip: getClientIp(request.headers),
    modelId: typeof body.modelId === "string" ? body.modelId : undefined,
    instructions: INSTRUCTIONS,
    messages: await convertToModelMessages(validated.data),
  });
  if (!run.ok) return run.response;

  after(() => run.settled);
  return run.result.toUIMessageStreamResponse({
    // 不把服务商的原始报错透给前端。
    onError: () => "model_error",
  });
}
