import { aiImageEnabled, runImage } from "@/core/ai";
import { handleImage } from "@/core/ai/handlers";
import { auth } from "@/core/auth/server";

// 同步生成，模型通常 10–40 秒出图；Vercel 上函数最长运行时间（秒）。
export const maxDuration = 120;

/** 示例图片接口：登录 → 限流 → 预扣积分 → 生成并存 R2，失败退款。 */
export async function POST(request: Request) {
  return handleImage(request, {
    enabled: aiImageEnabled,
    getUserId: async (req) =>
      (await auth.api.getSession({ headers: req.headers }))?.user.id ?? null,
    runImage,
  });
}
