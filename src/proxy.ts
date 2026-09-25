import { getSessionCookie } from "better-auth/cookies";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { isProtectedPath, SIGN_IN_PATH } from "@/core/auth/routes";
import { routing } from "@/core/i18n/routing";
import { localizedPath } from "@/core/seo/urls";

const intl = createMiddleware(routing);

/** 拆出路径里的语言前缀；没有前缀时是默认语言。 */
function splitLocale(pathname: string) {
  const [, first = "", ...rest] = pathname.split("/");
  if ((routing.locales as readonly string[]).includes(first)) {
    return { locale: first, path: `/${rest.join("/")}` };
  }
  return { locale: routing.defaultLocale, path: pathname };
}

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const { locale, path } = splitLocale(pathname);

  // 快速判断：没有 session cookie 就直接去登录页。cookie 是否有效由 (app) 的 layout 校验。
  if (isProtectedPath(path) && !getSessionCookie(request)) {
    const signIn = new URL(localizedPath(locale, SIGN_IN_PATH), request.url);
    signIn.searchParams.set("callbackURL", `${pathname}${search}`);
    return NextResponse.redirect(signIn);
  }

  return intl(request);
}

export const config = {
  // 跳过 API、Next 内部路径、带扩展名的静态文件（含 sitemap.xml / robots.txt）
  // 以及根目录的 opengraph-image。
  matcher: "/((?!api|trpc|_next|_vercel|opengraph-image|.*\\..*).*)",
};
