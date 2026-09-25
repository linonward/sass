"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { localizedPath } from "@/core/seo/urls";

import { SIGN_IN_PATH } from "./routes";
import { auth } from "./server";

/** 退出登录并回到登录页。用表单提交，不依赖客户端 JS；cookie 由 nextCookies 插件清除。 */
export async function signOut(locale: string) {
  await auth.api.signOut({ headers: await headers() });
  redirect(localizedPath(locale, SIGN_IN_PATH));
}
