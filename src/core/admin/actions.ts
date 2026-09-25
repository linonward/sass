"use server";

import { randomUUID } from "node:crypto";

import { APIError } from "better-auth/api";
import { refresh } from "next/cache";
import { headers } from "next/headers";

import { auth } from "@/core/auth/server";
import {
  adjustCredits,
  creditsEnabled,
  InsufficientCreditsError,
} from "@/core/credits";

import { adjustCreditsInput, adjustUserCredits } from "./credits";
import { getAdminSession } from "./session";

export type AdminErrorCode =
  | "forbidden"
  | "invalidAmount"
  | "reasonRequired"
  | "insufficient"
  | "cannotBanSelf"
  | "generic";

export type AdminActionState =
  | { status: "idle" }
  | { status: "success"; duplicate?: boolean; nextRequestId?: string }
  | { status: "error"; error: AdminErrorCode };

// Server Action 可以绕过页面直接调用，所以每个 action 都重新校验管理员身份。
const forbidden: AdminActionState = { status: "error", error: "forbidden" };

/** 调整积分：金额可正可负，必须填写原因；流水记录操作的管理员。 */
export async function adjustCreditsAction(
  _prev: AdminActionState,
  form: FormData,
): Promise<AdminActionState> {
  const session = await getAdminSession();
  if (!session || !creditsEnabled) return forbidden;

  const input = {
    userId: String(form.get("userId") ?? ""),
    amount: String(form.get("amount") ?? "").trim(),
    reason: String(form.get("reason") ?? ""),
    requestId: String(form.get("requestId") ?? ""),
  };
  const parsed = adjustCreditsInput.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      status: "error",
      error: field === "reason" ? "reasonRequired" : "invalidAmount",
    };
  }

  try {
    const result = await adjustUserCredits(
      { adjustCredits },
      session.user.id,
      parsed.data,
    );
    refresh();
    return {
      status: "success",
      duplicate: result.status === "duplicate",
      // 下一次调整用新的请求 ID；同一个 ID 重复提交（双击、重试）只生效一次。
      nextRequestId: randomUUID(),
    };
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return { status: "error", error: "insufficient" };
    }
    throw error;
  }
}

function authErrorCode(error: unknown): AdminErrorCode | undefined {
  if (!(error instanceof APIError)) return undefined;
  const code = (error.body as { code?: string } | undefined)?.code;
  if (code === "YOU_CANNOT_BAN_YOURSELF") return "cannotBanSelf";
  return "generic";
}

/** 封禁用户：Better Auth 会撤销他的所有 session，之后无法再登录。原因可选。 */
export async function banUserAction(
  _prev: AdminActionState,
  form: FormData,
): Promise<AdminActionState> {
  const session = await getAdminSession();
  if (!session) return forbidden;
  const userId = String(form.get("userId") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (userId === session.user.id) {
    return { status: "error", error: "cannotBanSelf" };
  }

  try {
    await auth.api.banUser({
      headers: await headers(),
      body: { userId, ...(reason && { banReason: reason.slice(0, 500) }) },
    });
  } catch (error) {
    const code = authErrorCode(error);
    if (code) return { status: "error", error: code };
    throw error;
  }
  refresh();
  return { status: "success" };
}

/** 解除封禁。 */
export async function unbanUserAction(
  _prev: AdminActionState,
  form: FormData,
): Promise<AdminActionState> {
  const session = await getAdminSession();
  if (!session) return forbidden;

  try {
    await auth.api.unbanUser({
      headers: await headers(),
      body: { userId: String(form.get("userId") ?? "") },
    });
  } catch (error) {
    const code = authErrorCode(error);
    if (code) return { status: "error", error: code };
    throw error;
  }
  refresh();
  return { status: "success" };
}
