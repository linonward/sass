import type { MetadataRoute } from "next";

import { routing } from "@/core/i18n/routing";
import { marketingRoutes } from "@/core/seo/routes";
import { absoluteUrl, languageAlternates } from "@/core/seo/urls";

export default function sitemap(): MetadataRoute.Sitemap {
  return marketingRoutes.flatMap((path) =>
    routing.locales.map((locale) => ({
      url: absoluteUrl(locale, path),
      alternates: { languages: languageAlternates(path) },
    })),
  );
}
