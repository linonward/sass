import { aiVideoEnabled, videoService } from "@/core/ai";
import { handleVideoStart } from "@/core/ai/handlers";
import { auth } from "@/core/auth/server";
import { scheduleOpportunisticRecovery } from "@/core/recovery";

/**
 * Example video endpoint: sign-in → rate limit → reserve credits → submit an async job. Poll the
 * result with GET /api/ai/video/:id.
 */
export async function POST(request: Request) {
  // A user is using AI: after responding, also advance other users' stuck jobs (bounded and
  // throttled; see src/core/recovery).
  if (aiVideoEnabled) scheduleOpportunisticRecovery();
  return handleVideoStart(request, {
    enabled: aiVideoEnabled,
    getUserId: async (req) =>
      (await auth.api.getSession({ headers: req.headers }))?.user.id ?? null,
    startVideo: videoService.startVideo,
  });
}
