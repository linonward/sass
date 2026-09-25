import { headers } from "next/headers";
import { cache } from "react";

import { redirect } from "@/core/i18n/navigation";

import { SIGN_IN_PATH } from "./routes";
import { auth } from "./server";

/** 当前请求的 session；未登录时为 null。同一次渲染内只查询一次。 */
export const getSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);

/**
 * 登录后页面开头调用：没有有效 session 时跳转登录页。
 * layout 和 page 是并行渲染的，(app) layout 里的检查挡不住 page（cookie 还在但 session 已失效时，
 * page 会先拿到 null），所以用到 session 的页面都要自己检查。
 */
export async function requirePageSession(locale: string) {
  const session = await getSession();
  if (!session) return redirect({ href: SIGN_IN_PATH, locale });
  return session;
}
