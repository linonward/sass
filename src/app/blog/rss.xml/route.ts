import { rssResponse } from "@/core/blog/pages";
import { routing } from "@/core/i18n/routing";

// 默认语言的 RSS：/blog/rss.xml。带扩展名的路径不经过 proxy，不会被改写到 [locale] 下，
// 所以放在 app 根目录。其他语言见 src/app/[locale]/(marketing)/blog/rss.xml/。
export const dynamic = "force-static";

export function GET() {
  return rssResponse(routing.defaultLocale);
}
