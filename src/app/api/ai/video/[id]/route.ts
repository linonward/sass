import { aiVideoEnabled, videoService } from "@/core/ai";
import { handleVideoStatus } from "@/core/ai/handlers";
import { auth } from "@/core/auth/server";
import { scheduleOpportunisticRecovery } from "@/core/recovery";

// On completion the video is downloaded and written to R2 (usually a few MB).
export const maxDuration = 60;

/** Poll a video job; copy the result to R2 when done, refund on failure or timeout. */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/ai/video/[id]">,
) {
  const { id } = await params;
  // A user is using AI: after responding, also advance other users' stuck jobs (bounded and
  // throttled; see src/core/recovery).
  if (aiVideoEnabled) scheduleOpportunisticRecovery();
  return handleVideoStatus(request, id, {
    enabled: aiVideoEnabled,
    getUserId: async (req) =>
      (await auth.api.getSession({ headers: req.headers }))?.user.id ?? null,
    pollVideo: videoService.pollVideo,
  });
}
