import { getSessionCookie } from "better-auth/cookies";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import {
  isDisabledPath,
  isProtectedPath,
  SIGN_IN_PATH,
} from "@/core/auth/routes";
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

  // 模块关闭后整块下线的页面在这里就 404：(app) 的 layout 比 page 先渲染完，
  // 留给页面 notFound() 的话未登录访客会先被送去登录页 —— 同一个地址两种身份两个结果。
  // 判定在渲染之前，未登录和已登录拿到同一个 404。
  if (isDisabledPath(path)) return new NextResponse(null, { status: 404 });

  // 快速判断：没有 session cookie 就直接去登录页。cookie 是否有效由 (app) 的 layout 校验。
  if (isProtectedPath(path) && !getSessionCookie(request)) {
    const signIn = new URL(localizedPath(locale, SIGN_IN_PATH), request.url);
    signIn.searchParams.set("callbackURL", `${pathname}${search}`);
    return NextResponse.redirect(signIn);
  }

  return intl(request);
}

export const config = {
  // 跳过 API、Next 内部路径、带扩展名的静态文件（含 sitemap.xml / robots.txt）、
  // app 根目录的 metadata 路由，以及 Sentry 的转发路径（SENTRY_TUNNEL_ROUTE，matcher 只能写字面量）。
  // metadata 路由必须在这里：它们注入的 URL 不带语言前缀（`/icon`、`/opengraph-image`），
  // 被 next-intl 改写成 `/<locale>/icon` 就成了 404 —— 标签页又变回空白。
  // `icon$` 锚到整段，免得把 `/icons` 这种普通页面也一起排除掉。
  // `api/` 而不是 `api`：只排除 `/api/**` 接口，不然以 api 开头的页面路径（`/api-keys`）
  // 会连语言前缀重写一起被跳过 —— 不带前缀访问时落到 `[locale] = "api-keys"`，页面变 404。
  matcher:
    "/((?!api/|trpc|_next|_vercel|opengraph-image|icon$|monitoring|.*\\..*).*)",
};
