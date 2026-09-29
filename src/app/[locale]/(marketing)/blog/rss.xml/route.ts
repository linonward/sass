import { rssResponse } from "@/core/blog/pages";
import { routing } from "@/core/i18n/routing";

// RSS for non-default locales: /<locale>/blog/rss.xml. The default locale's feed is in
// src/app/blog/rss.xml/ — paths with an extension skip the proxy, so the default locale is never
// rewritten under [locale].
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
