import { rssResponse } from "@/core/blog/pages";
import { routing } from "@/core/i18n/routing";

// RSS for the default locale: /blog/rss.xml. Paths with an extension skip the proxy and are never
// rewritten under [locale], so this lives at the app root. Other locales: see
// src/app/[locale]/(marketing)/blog/rss.xml/.
export const dynamic = "force-static";

export function GET() {
  return rssResponse(routing.defaultLocale);
}
