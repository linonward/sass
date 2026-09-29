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

// Server Actions can be called directly, bypassing the page, so every action re-checks admin
// identity.
const forbidden: AdminActionState = { status: "error", error: "forbidden" };

/**
 * Adjust credits: the amount may be positive or negative and a reason is required; the transaction
 * records the acting admin.
 */
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
      // The next adjustment uses a new request ID; resubmitting the same ID (double click, retry)
      // takes effect only once.
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

/**
 * Ban a user: Better Auth revokes all their sessions and they can no longer sign in. The reason is
 * optional.
 */
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

/** Lift a ban. */
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
