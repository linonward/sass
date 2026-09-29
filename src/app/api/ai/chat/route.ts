import { after } from "next/server";

import { aiEnabled, runAI } from "@/core/ai";
import { handleChat } from "@/core/ai/chat";
import { auth } from "@/core/auth/server";
import { scheduleOpportunisticRecovery } from "@/core/recovery";

// 流式生成可能较久；Vercel 上函数最长运行时间（秒）。
export const maxDuration = 60;

/** 示例聊天接口：登录 → 限流 → 预扣积分 → 流式输出，失败退款。 */
export async function POST(request: Request) {
  // 用户在用 AI 功能：响应之后顺带推进别人悬着的任务（有界、限频，见 src/core/recovery）。
  if (aiEnabled) scheduleOpportunisticRecovery();
  return handleChat(request, {
    enabled: aiEnabled,
    getUserId: async (req) =>
      (await auth.api.getSession({ headers: req.headers }))?.user.id ?? null,
    runAI,
    after,
  });
}
