import {
  aiImageEnabled,
  aiVideoEnabled,
  listGenerations,
  listPendingVideos,
} from "@/core/ai";
import { handleGenerations } from "@/core/ai/handlers";
import { auth } from "@/core/auth/server";
import { scheduleOpportunisticRecovery } from "@/core/recovery";

/** The current user's recent image and video generations. */
export async function GET(request: Request) {
  // A user is using AI: after responding, also advance other users' stuck jobs (bounded and
  // throttled; see src/core/recovery).
  if (aiImageEnabled || aiVideoEnabled) scheduleOpportunisticRecovery();
  return handleGenerations(request, {
    enabled: aiImageEnabled || aiVideoEnabled,
    getUserId: async (req) =>
      (await auth.api.getSession({ headers: req.headers }))?.user.id ?? null,
    listGenerations,
    listPendingVideos,
  });
}
