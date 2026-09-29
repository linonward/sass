import { aiVideoEnabled, videoService } from "@/core/ai";
import { handleVideoStatus } from "@/core/ai/handlers";
import { auth } from "@/core/auth/server";
import { scheduleOpportunisticRecovery } from "@/core/recovery";

// 完成时要下载视频并写进 R2（通常几 MB）。
export const maxDuration = 60;

/** 查询视频任务；完成后转存 R2，失败或超时退款。 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/ai/video/[id]">,
) {
  const { id } = await params;
  // 用户在用 AI 功能：响应之后顺带推进别人悬着的任务（有界、限频，见 src/core/recovery）。
  if (aiVideoEnabled) scheduleOpportunisticRecovery();
  return handleVideoStatus(request, id, {
    enabled: aiVideoEnabled,
    getUserId: async (req) =>
      (await auth.api.getSession({ headers: req.headers }))?.user.id ?? null,
    pollVideo: videoService.pollVideo,
  });
}
