"use server";

import { hasLocale } from "next-intl";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { SIGN_IN_PATH } from "@/core/auth/routes";
import { auth } from "@/core/auth/server";
import { routing } from "@/core/i18n/routing";
import { localizedPath } from "@/core/seo/urls";

import { deleteUserAccount } from "./delete-user";
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

/** 修改显示名称。 */
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

/** 修改偏好语言，并跳到该语言下的设置页，让界面立即切换。 */
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
  // next-intl 按 cookie 记住界面语言；和语言切换器一样同步更新。
  (await cookies()).set("NEXT_LOCALE", next, { path: "/", sameSite: "lax" });
  redirect(localizedPath(next, "/settings"));
}

/**
 * 删除当前账户。需要在确认框里输入自己的邮箱；任何 onUserDelete 钩子失败都会中止删除。
 * 成功后清除登录 cookie 并回到首页。
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
    console.error("[account] failed to delete user", error);
    return { status: "error", error: "generic" };
  }

  // session 已随用户级联删除；再清掉浏览器里的登录 cookie。
  const { authCookies } = await auth.$context;
  const jar = await cookies();
  // 沿用 Better Auth 的属性（__Secure- 前缀的 cookie 必须带 Secure 才能被覆盖）。
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
