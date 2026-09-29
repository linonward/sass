import { aiImageEnabled, runImage } from "@/core/ai";
import { handleImage } from "@/core/ai/handlers";
import { auth } from "@/core/auth/server";
import { scheduleOpportunisticRecovery } from "@/core/recovery";

// Generation is synchronous and models usually take 10–40 seconds per image; maximum function
// duration on Vercel (seconds).
export const maxDuration = 120;

/** Example image endpoint: sign-in → rate limit → reserve credits → generate and store in R2; refund on failure. */
export async function POST(request: Request) {
  // A user is using AI: after responding, also advance other users' stuck jobs (bounded and
  // throttled; see src/core/recovery).
  if (aiImageEnabled) scheduleOpportunisticRecovery();
  return handleImage(request, {
    enabled: aiImageEnabled,
    getUserId: async (req) =>
      (await auth.api.getSession({ headers: req.headers }))?.user.id ?? null,
    runImage,
  });
}
