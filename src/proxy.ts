import createMiddleware from "next-intl/middleware";

import { routing } from "@/core/i18n/routing";

export default createMiddleware(routing);

export const config = {
  // 跳过 API、Next 内部路径和带扩展名的静态文件。
  matcher: "/((?!api|trpc|_next|_vercel|.*\\..*).*)",
};
