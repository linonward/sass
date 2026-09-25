import { rssResponse } from "@/core/blog/pages";
import { routing } from "@/core/i18n/routing";

// 非默认语言的 RSS：/<locale>/blog/rss.xml。默认语言的在 src/app/blog/rss.xml/。
// 带扩展名的路径不经过 proxy，所以默认语言不会被改写到 [locale] 下。
export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales
    .filter((locale) => locale !== routing.defaultLocale)
    .map((locale) => ({ locale }));
}

export async function GET(
  _request: Request,
  { params }: RouteContext<"/[locale]/blog/rss.xml">,
) {
  return rssResponse((await params).locale);
}
