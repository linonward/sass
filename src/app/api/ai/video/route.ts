import { aiVideoEnabled, videoService } from "@/core/ai";
import { handleVideoStart } from "@/core/ai/handlers";
import { auth } from "@/core/auth/server";
import { scheduleOpportunisticRecovery } from "@/core/recovery";

/** 示例视频接口：登录 → 限流 → 预扣积分 → 提交异步任务。结果用 GET /api/ai/video/:id 查询。 */
export async function POST(request: Request) {
  // 用户在用 AI 功能：响应之后顺带推进别人悬着的任务（有界、限频，见 src/core/recovery）。
  if (aiVideoEnabled) scheduleOpportunisticRecovery();
  return handleVideoStart(request, {
    enabled: aiVideoEnabled,
    getUserId: async (req) =>
      (await auth.api.getSession({ headers: req.headers }))?.user.id ?? null,
    startVideo: videoService.startVideo,
  });
}
