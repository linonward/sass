import { after } from "next/server";

import { aiEnabled, runAI } from "@/core/ai";
import { handleChat } from "@/core/ai/chat";
import { auth } from "@/core/auth/server";
import { scheduleOpportunisticRecovery } from "@/core/recovery";

// Streaming can take a while; maximum function duration on Vercel (seconds).
export const maxDuration = 60;

/** Example chat endpoint: sign-in → rate limit → reserve credits → stream output; refund on failure. */
export async function POST(request: Request) {
  // A user is using AI: after responding, also advance other users' stuck jobs (bounded and
  // throttled; see src/core/recovery).
  if (aiEnabled) scheduleOpportunisticRecovery();
  return handleChat(request, {
    enabled: aiEnabled,
    getUserId: async (req) =>
      (await auth.api.getSession({ headers: req.headers }))?.user.id ?? null,
    runAI,
    after,
  });
}
