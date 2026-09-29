import {
  aiImageEnabled,
  aiVideoEnabled,
  listGenerations,
  listPendingVideos,
} from "@/core/ai";
import { handleGenerations } from "@/core/ai/handlers";
import { auth } from "@/core/auth/server";
import { scheduleOpportunisticRecovery } from "@/core/recovery";

/** 当前用户最近的图片、视频生成。 */
export async function GET(request: Request) {
  // 用户在用 AI 功能：响应之后顺带推进别人悬着的任务（有界、限频，见 src/core/recovery）。
  if (aiImageEnabled || aiVideoEnabled) scheduleOpportunisticRecovery();
  return handleGenerations(request, {
    enabled: aiImageEnabled || aiVideoEnabled,
    getUserId: async (req) =>
      (await auth.api.getSession({ headers: req.headers }))?.user.id ?? null,
    listGenerations,
    listPendingVideos,
  });
}
