import { convertToModelMessages, safeValidateUIMessages } from "ai";

import { getClientIp } from "@/core/ratelimit/limiter";

import type { RunAIInput, RunAIResult } from "./run";

// Request body limit. Each call deducts a fixed charge, so an overly long context would let the
// cost of a single call run away; raise it in your own route if you need longer.
export const MAX_CHAT_BODY_BYTES = 64 * 1024;

const INSTRUCTIONS = "You are a helpful assistant. Answer concisely.";

export type ChatDeps = {
  enabled: boolean;
  getUserId: (request: Request) => Promise<string | null>;
  runAI: (input: RunAIInput) => Promise<RunAIResult>;
  // Registers work that must still finish after the response ends (next/server's after).
  after: (task: () => Promise<unknown>) => void;
};

/**
 * Handler for `POST /api/ai/chat`: the body is the `{ messages, modelId? }` sent by useChat, and it
 * returns a UI message stream. Error responses are JSON `{ error }`; the frontend picks the copy
 * to show based on error.
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
    // Don't leak the provider's raw error to the frontend.
    onError: () => "model_error",
  });
}
