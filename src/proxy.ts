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
  // 登录页的语言取自地址前缀（没有前缀时是默认语言）—— 这一步在语言检测之前，所以
  // `/dashboard` 这种带前缀的地址会去同语言的登录页，不带前缀的地址一律去默认语言的登录页。
  if (isProtectedPath(path) && !getSessionCookie(request)) {
    const signIn = new URL(localizedPath(locale, SIGN_IN_PATH), request.url);
    signIn.searchParams.set("callbackURL", `${pathname}${search}`);
    return NextResponse.redirect(signIn);
  }

  const response = intl(request);

  // 语言 cookie 的语义是「用户明确选过这门语言」，所以**只**由语言切换器写
  // （core/i18n/locale-switcher.tsx）。中间件会在「访问了带前缀的地址」时自己写一个，
  // 那意味着英文访客点开一条 /zh 分享链接就被永久记成中文 —— 之后每次访问 / 都被送去 /zh。
  // 中间件只会写这一个 cookie（next-intl/middleware 的 syncCookie），所以整条删掉是安全的；
  // e2e/i18n/detection.spec.ts 锁着这个行为。
  response.headers.delete("set-cookie");

  // 不带前缀的地址跳到哪门语言取决于 Accept-Language，缓存键就必须带上它，
  // 否则中文访客的 307 会被缓存下来发给英文访客（反向也一样）。带前缀的地址永远是
  // 它自己那门语言，加 Vary 只会白白把 CDN 缓存切成几份。
  //
  // 只有中间件自己返回的响应（跳转）真能带上这个头：请求继续往下走时 Next 会重建
  // 200 响应的 Vary（实测是 `rsc, next-router-*, Accept-Encoding`），中间件加的值到不了
  // 客户端。这样够用 —— 200 的正文本来就跟 Accept-Language 无关（不带前缀的 200 就是
  // 默认语言的页面），真正需要区分语言的是跳转；而 Vercel 上中间件先于 CDN 缓存执行
  // （实测带 zh 的请求即使页面在缓存里也仍然拿到 307），所以缓存也不会把两者串起来。
  if (path === pathname) response.headers.append("vary", "Accept-Language");

  return response;
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
