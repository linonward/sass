import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { Link } from "@/core/i18n/navigation";
import { SiteFooter } from "@/core/layout/site-footer";
import { SiteHeader } from "@/core/layout/site-header";
import { buildMetadata } from "@/core/seo/metadata";
import { buttonVariants } from "@/core/ui/button";

/**
 * The title is written twice — a metadata export plus a React `<title>` — and dropping either one
 * breaks one of the paths, so don't delete either.
 *
 * - The metadata export sets the `<title>` in the **static HTML**, i.e. what browsers with JS off
 *   and HTML-only crawlers see. Next has a dedicated collection path for not-found: on an HTTP
 *   access fallback the errorType is recorded as `'not-found'`, this file's export is picked up
 *   under the 'not-found' convention, and it's ordered after the layout so it overrides it.
 *   path is `null`: a 404 has no canonical URL of its own, so canonical / hreflang / og:url must
 *   be cleared explicitly, or they'd inherit the layout's, which point at the home page (see the
 *   comments in src/core/seo/metadata.ts). noindex is **injected by the framework** (NonIndex in
 *   app-render.js) based on pagePath === '/404' and the status code, not through here — so don't
 *   pass noIndex to "keep it safe"; that would add a second robots meta.
 * - The React `<title>` sets the DOM **after hydration**. The 404 fallback is rendered by a client
 *   boundary, and on hydration the client tree only has the layout's metadata, which would reset
 *   `<title>` to the site name; with a React `<title>` in the component, React inserts it into
 *   head ahead of the existing title, browsers take the first one, and the title comes out right.
 *
 * Without JS this page's body is empty (just an empty `<div hidden>` shell): that's inherent to
 * client boundaries, not a broken template. The two measures above fix `<title>`, not the body.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "NotFound" });
  return buildMetadata({
    locale,
    path: null,
    title: t("title"),
    description: t("description"),
  });
}

export default function NotFound() {
  const t = useTranslations("NotFound");

  return (
    // This page lives under [locale]/, not in the (marketing) group, so it can't reach the marketing
    // layout; Header / Footer are rendered here directly — a 404 needs site navigation too, and "Back
    // to home" as the only way out isn't enough.
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="container-marketing flex flex-1 items-center py-14 sm:py-20">
        <div className="max-w-2xl">
          <title>{t("title")}</title>
          {/* Text uses --primary-text rather than --primary: the latter keeps the raw configured hex,
              which isn't legible enough on the canvas in the dark theme (color roles in design.md §2). */}
          <p className="text-primary-text font-mono text-sm font-medium tracking-[0.2em]">
            404
          </p>
          {/* Every h1 on the site uses the display face; this one used to be missed. */}
          <h1 className="heading-display mt-4 text-4xl sm:text-5xl">
            {t("title")}
          </h1>
          <p className="text-muted-foreground mt-4 text-lg text-pretty">
            {t("description")}
          </p>
          {/* Marketing CTAs are 44px stickers with a lip; the default 32px is also below the touch-target
              minimum in design.md. */}
          <Link
            href="/"
            className={`${buttonVariants({ size: "marketing", tone: "primary" })} mt-8`}
          >
            {t("back")}
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
