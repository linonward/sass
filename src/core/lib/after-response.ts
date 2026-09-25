import { after } from "next/server";

/**
 * 在响应返回之后执行 task（Next 的 `after`，Vercel 上靠 waitUntil 保证跑完），
 * 用于发邮件这类不影响结果、失败也只记日志的副作用。
 * 不在请求作用域里（测试、脚本）时 `after` 会抛错，这时直接执行并等它结束。
 * task 自己处理错误。
 */
export async function runAfterResponse(task: () => Promise<void>) {
  try {
    after(task);
    return;
  } catch {
    // 不在请求作用域里。
  }
  await task();
}
