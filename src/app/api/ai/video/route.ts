import { aiVideoEnabled, videoService } from "@/core/ai";
import { handleVideoStart } from "@/core/ai/handlers";
import { auth } from "@/core/auth/server";

/** 示例视频接口：登录 → 限流 → 预扣积分 → 提交异步任务。结果用 GET /api/ai/video/:id 查询。 */
export async function POST(request: Request) {
  return handleVideoStart(request, {
    enabled: aiVideoEnabled,
    getUserId: async (req) =>
      (await auth.api.getSession({ headers: req.headers }))?.user.id ?? null,
    startVideo: videoService.startVideo,
  });
}
