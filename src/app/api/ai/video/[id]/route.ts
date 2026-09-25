import { aiVideoEnabled, videoService } from "@/core/ai";
import { handleVideoStatus } from "@/core/ai/handlers";
import { auth } from "@/core/auth/server";

// 完成时要下载视频并写进 R2（通常几 MB）。
export const maxDuration = 60;

/** 查询视频任务；完成后转存 R2，失败或超时退款。 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/ai/video/[id]">,
) {
  const { id } = await params;
  return handleVideoStatus(request, id, {
    enabled: aiVideoEnabled,
    getUserId: async (req) =>
      (await auth.api.getSession({ headers: req.headers }))?.user.id ?? null,
    pollVideo: videoService.pollVideo,
  });
}
