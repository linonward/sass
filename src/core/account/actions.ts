"use server";

import { hasLocale } from "next-intl";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  cookieOptions,
  SOURCE_COOKIE,
  RETRY_COOKIE,
} from "@/core/acquisition/tokens";
import { SIGN_IN_PATH } from "@/core/auth/routes";
import { auth } from "@/core/auth/server";
import { routing } from "@/core/i18n/routing";
import { logger } from "@/core/observability/logger";
import { localizedPath } from "@/core/seo/urls";

import type { ConfirmActionResult } from "@/core/ui/confirm-action-dialog";

import { deleteUserAccount } from "./delete-user";
import { sessionTokenFor } from "./devices";
import { OnUserDeleteError } from "./on-user-delete";

export type ActionState =
  | { status: "idle" }
  | { status: "success" }
  | {
      status: "error";
      error: "invalid" | "mismatch" | "hookFailed" | "generic";
    };

const NAME_MAX = 80;

async function requireSession(locale: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(localizedPath(locale, SIGN_IN_PATH));
  return session;
}

/** Update the display name. */
export async function updateName(
  locale: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireSession(locale);
  const name = String(form.get("name") ?? "").trim();
  if (!name || name.length > NAME_MAX) {
    return { status: "error", error: "invalid" };
  }
  await auth.api.updateUser({ headers: await headers(), body: { name } });
  return { status: "success" };
}

/**
 * Update the preferred locale and redirect to the settings page in that locale so the UI switches
 * immediately.
 */
export async function updateLocale(
  locale: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireSession(locale);
  const next = String(form.get("locale") ?? "");
  if (!hasLocale(routing.locales, next)) {
    return { status: "error", error: "invalid" };
  }
  await auth.api.updateUser({
    headers: await headers(),
    body: { locale: next },
  });
  // next-intl remembers the UI locale in a cookie; update it too, the same way the locale switcher
  // does.
  (await cookies()).set("NEXT_LOCALE", next, { path: "/", sameSite: "lax" });
  redirect(localizedPath(next, "/settings"));
}

/**
 * Delete the current account. The user must type their own email into the confirmation box; if any
 * onUserDelete hook fails, the deletion is aborted. On success, clear the auth cookies and go back
 * to the home page.
 */
export async function deleteAccount(
  locale: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession(locale);
  const confirm = String(form.get("confirm") ?? "")
    .trim()
    .toLowerCase();
  if (confirm !== session.user.email.toLowerCase()) {
    return { status: "error", error: "mismatch" };
  }

  try {
    await deleteUserAccount({
      userId: session.user.id,
      email: session.user.email,
    });
  } catch (error) {
    if (error instanceof OnUserDeleteError) {
      return { status: "error", error: "hookFailed" };
    }
    logger.error("account.delete_failed", {
      error,
      userId: session.user.id,
    });
    return { status: "error", error: "generic" };
  }

  // Sessions were cascade-deleted with the user; now clear the auth cookies in the browser.
  const { authCookies } = await auth.$context;
  const jar = await cookies();
  for (const name of [SOURCE_COOKIE, RETRY_COOKIE]) {
    if (jar.has(name)) jar.set(name, "", { ...cookieOptions, maxAge: 0 });
  }
  // Reuse Better Auth's attributes (a cookie with the __Secure- prefix can only be overwritten when
  // Secure is set).
  for (const { name, attributes } of Object.values(authCookies)) {
    jar.set(name, "", {
      path: attributes.path,
      domain: attributes.domain,
      secure: attributes.secure,
      httpOnly: attributes.httpOnly,
      sameSite: attributes.sameSite?.toLowerCase() as "lax" | "strict" | "none",
      maxAge: 0,
    });
  }
  redirect(localizedPath(locale, "/"));
}

export type DeviceActionError = "notFound" | "current" | "generic";

/**
 * Sign out one of the user's other devices. The browser only knows session ids; the token is
 * looked up here, and only among the user's own sessions. The current device is refused: signing
 * yourself out belongs to the sign-out button, not this list.
 */
export async function signOutDevice(
  locale: string,
  form: FormData,
): Promise<ConfirmActionResult<DeviceActionError>> {
  const session = await requireSession(locale);
  const sessionId = String(form.get("sessionId") ?? "");
  if (sessionId === session.session.id) {
    return { status: "error", error: "current" };
  }
  const token = await sessionTokenFor(session.user.id, sessionId);
  if (!token) return { status: "error", error: "notFound" };
  try {
    await auth.api.revokeSession({
      headers: await headers(),
      body: { token },
    });
  } catch (error) {
    logger.error("account.sign_out_device_failed", {
      error,
      userId: session.user.id,
    });
    return { status: "error", error: "generic" };
  }
  return { status: "success" };
}

/** Sign out every device except this one. */
export async function signOutOtherDevices(
  locale: string,
): Promise<ConfirmActionResult<DeviceActionError>> {
  const session = await requireSession(locale);
  try {
    await auth.api.revokeOtherSessions({ headers: await headers() });
  } catch (error) {
    logger.error("account.sign_out_other_devices_failed", {
      error,
      userId: session.user.id,
    });
    return { status: "error", error: "generic" };
  }
  return { status: "success" };
}
