"use server";

import { z } from "zod";

import { getAdminSession } from "@/core/admin/session";

import { exceptionService } from "./index";

export type ExceptionActionState =
  | { status: "idle" }
  | { status: "success"; result: string; closed: boolean }
  | {
      status: "error";
      error: "forbidden" | "reasonRequired" | "invalid" | "notOpen";
    };

const input = z.object({
  exceptionId: z.uuid(),
  action: z.enum(["retry_reclaim", "recheck", "resend", "resolve", "ignore"]),
  reason: z.string().trim().min(1).max(500),
});

/**
 * 异常台的所有处理动作走这一个入口。Server Action 可以绕过页面直接调用，
 * 所以这里重新校验管理员身份（页面上的 requireAdmin 挡不住直接调用）。
 * 每个动作都必须填理由，理由和结果写进 admin_actions。
 */
export async function exceptionAction(
  _prev: ExceptionActionState,
  form: FormData,
): Promise<ExceptionActionState> {
  const session = await getAdminSession();
  if (!session) return { status: "error", error: "forbidden" };

  const parsed = input.safeParse({
    exceptionId: form.get("exceptionId"),
    action: form.get("action"),
    reason: form.get("reason") ?? "",
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      status: "error",
      error: field === "reason" ? "reasonRequired" : "invalid",
    };
  }

  const { action, ...rest } = parsed.data;
  const args = { ...rest, actorId: session.user.id };
  const outcome =
    action === "retry_reclaim"
      ? await exceptionService.retryReclaim(args)
      : action === "recheck"
        ? await exceptionService.recheck(args)
        : action === "resend"
          ? await exceptionService.resendNotification(args)
          : await exceptionService.resolve({
              ...args,
              status: action === "resolve" ? "resolved" : "ignored",
            });

  if (!outcome.ok) {
    return {
      status: "error",
      error: outcome.error === "not_open" ? "notOpen" : "invalid",
    };
  }
  // 不在这里 refresh()：按「待处理」筛选时，刚关掉的单子会从列表里消失，连带弹层和
  // 结果一起被卸载，管理员看不到处理结果。弹层关掉时由客户端刷新（见 ui/handle-dialog.tsx）。
  return { status: "success", result: outcome.result, closed: outcome.closed };
}
