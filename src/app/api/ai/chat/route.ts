import { after } from "next/server";

import { aiEnabled, runAI } from "@/core/ai";
import { handleChat } from "@/core/ai/chat";
import { auth } from "@/core/auth/server";

// 流式生成可能较久；Vercel 上函数最长运行时间（秒）。
export const maxDuration = 60;

/** 示例聊天接口：登录 → 限流 → 预扣积分 → 流式输出，失败退款。 */
export async function POST(request: Request) {
  return handleChat(request, {
    enabled: aiEnabled,
    getUserId: async (req) =>
      (await auth.api.getSession({ headers: req.headers }))?.user.id ?? null,
    runAI,
    after,
  });
}
