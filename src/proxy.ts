import createMiddleware from "next-intl/middleware";

import { routing } from "@/core/i18n/routing";

export default createMiddleware(routing);

export const config = {
  // 跳过 API、Next 内部路径、带扩展名的静态文件（含 sitemap.xml / robots.txt）
  // 以及根目录的 opengraph-image。
  matcher: "/((?!api|trpc|_next|_vercel|opengraph-image|.*\\..*).*)",
};
