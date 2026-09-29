import { rssResponse } from "@/core/changelog/pages";
import { routing } from "@/core/i18n/routing";

// RSS for the default locale: /changelog/rss.xml. Paths with an extension skip the proxy and are
// never rewritten under [locale], so this lives at the app root. Other locales: see
// src/app/[locale]/(marketing)/changelog/rss.xml/.
export const dynamic = "force-static";

export function GET() {
  return rssResponse(routing.defaultLocale);
}
