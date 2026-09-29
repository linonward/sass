import type { MetadataRoute } from "next";

import { siteUrl } from "@/core/seo/urls";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      /*
       * Block machine endpoints only, not pages.
       *
       * dashboard / admin are HTML pages, excluded by the pages' own `noIndex` (set on both). A path
       * blocked by Disallow can't be crawled, so the crawler never sees that noindex, and with inbound
       * links it may show up in results as a bare URL: stacking both blocks makes them cancel out. When
       * signed out these pages also 307 to the sign-in page, which is noindex too (see src/proxy.ts), so
       * crawlers never get indexable content anyway.
       *
       * /api is JSON with nowhere to put a <meta> (unmatched paths fall back to X-Robots-Tag, see
       * src/app/api/[...rest]/route.ts); endpoints without HTML are exactly what Disallow is for.
       */
      disallow: ["/api"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
