import {
  aiImageEnabled,
  aiVideoEnabled,
  listGenerations,
  listPendingVideos,
} from "@/core/ai";
import { handleGenerations } from "@/core/ai/handlers";
import { auth } from "@/core/auth/server";

/** 当前用户最近的图片、视频生成。 */
export async function GET(request: Request) {
  return handleGenerations(request, {
    enabled: aiImageEnabled || aiVideoEnabled,
    getUserId: async (req) =>
      (await auth.api.getSession({ headers: req.headers }))?.user.id ?? null,
    listGenerations,
    listPendingVideos,
  });
}
