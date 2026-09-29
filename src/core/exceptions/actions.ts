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
 * Every action on the exceptions page goes through this single entry point. A Server Action can be
 * called directly, bypassing the page, so admin identity is re-checked here (the page's requireAdmin
 * can't stop direct calls). Every action requires a reason; the reason and the result are written
 * to admin_actions.
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
  // No refresh() here: when filtering by "open", the exception that was just closed would drop out
  // of the list, unmounting the dialog and its result with it, and the admin would never see the
  // outcome. The client refreshes when the dialog closes (see ui/handle-dialog.tsx).
  return { status: "success", result: outcome.result, closed: outcome.closed };
}
