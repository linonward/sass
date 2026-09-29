import { aiImageEnabled, runImage } from "@/core/ai";
import { handleImage } from "@/core/ai/handlers";
import { auth } from "@/core/auth/server";
import { scheduleOpportunisticRecovery } from "@/core/recovery";

// 同步生成，模型通常 10–40 秒出图；Vercel 上函数最长运行时间（秒）。
export const maxDuration = 120;

/** 示例图片接口：登录 → 限流 → 预扣积分 → 生成并存 R2，失败退款。 */
export async function POST(request: Request) {
  // 用户在用 AI 功能：响应之后顺带推进别人悬着的任务（有界、限频，见 src/core/recovery）。
  if (aiImageEnabled) scheduleOpportunisticRecovery();
  return handleImage(request, {
    enabled: aiImageEnabled,
    getUserId: async (req) =>
      (await auth.api.getSession({ headers: req.headers }))?.user.id ?? null,
    runImage,
  });
}
