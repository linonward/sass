import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";

import { routing } from "@/core/i18n/routing";
import { cn } from "@/core/lib/utils";
import { brandCss } from "@/core/theme/brand-css";
import { ThemeProvider } from "@/core/theme/theme-provider";
import { buttonVariants } from "@/core/ui/button";

import siteConfig from "../../site.config";
import "./globals.css";

// Root-level 404: catches the paths whose page can't render at all.
//
// Why it's needed: the matcher in src/proxy.ts skips paths containing a dot and /api, so those
// requests aren't rewritten to /<locale>/... by next-intl; instead the [locale] dynamic segment
// swallows them whole (the locale of /missing.png is "missing.png"). The hasLocale check in
// [locale]/layout.tsx fails and throws notFound() there, but the not-found.tsx in the same segment is
// a child of that layout and can't catch it — so it degrades to the framework's built-in default 404
// page (brand color, theme, localization and "back to home" all lost). Placing this file at the app
// root makes it the parent boundary of that layout.
//
// Verified in practice (the two forms of 404 and the status code conventions are covered in the
// README section on error and permission boundaries):
// 1. This path doesn't need experimental.globalNotFound — a root-level not-found.tsx is enough, and
//    it renders into the framework's <html id="__next_error__"> document, so it must not wrap
//    another <html>.
// 2. This file is prerendered into the RSC payload of **every page** (client-side notFound needs
//    it), so it must not touch any request-scoped next-intl API: the request locale on this path is
//    broken, and next-intl's getConfig() (which getMessages / useTranslations / even
//    NextIntlClientProvider go through to get now and timeZone) falls back to rootParams.locale()
//    — so src/core/i18n/request.ts:12 throws notFound() again, the boundary content becomes an
//    error row, and the whole page is blank (exactly what we observed in production). So this file
//    uses only the default locale's messages, reading messages/<defaultLocale>.json directly the way
//    request.ts does, bypassing the request config.
//
// Inlining the localized messages means a small overlap with [locale]/not-found.tsx — that file is
// a child of the layout and uses useTranslations; the two run in different environments and can't
// share code.

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
});
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export default async function RootNotFound() {
  // These paths have no locale prefix (like /missing.png), so use the default locale.
  const locale = routing.defaultLocale;
  const messages = (await import(`../../messages/${locale}.json`)).default;
  const t = messages.NotFound;

  return (
    <>
      {/* The brand color variables injected by [locale]/layout.tsx don't exist on this path, so add
          our own. We're inside a client boundary, so <style> needs href + precedence (React only hoists
          styles with a precedence), otherwise client rendering throws. */}
      <style href="brand-colors" precedence="high">
        {brandCss(siteConfig.brand)}
      </style>
      {/* Likewise, the font variables the layout puts on <html> aren't here either, so attach them to
          our own container. Add font-sans too: globals.css's html { @apply font-sans } relies on those
          variables, which this path's <html> doesn't have. */}
      <ThemeProvider>
        <main
          className={cn(
            geist.variable,
            display.variable,
            mono.variable,
            "font-sans",
            "flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center",
          )}
        >
          <title>{t.title}</title>
          {/* Same register as [locale]/not-found.tsx: text uses --primary-text rather than --primary
              (the latter is the raw configured hex, not legible enough on a dark canvas), the h1 uses the
              display face, and the CTA is the marketing 44px sticker button. This path can't reach the
              marketing layout, so there's no Header / Footer — it only catches requests with an extension,
              like /missing.png. */}
          <p className="text-primary-text font-mono text-sm font-medium tracking-[0.2em]">
            404
          </p>
          <h1 className="heading-display text-4xl sm:text-5xl">{t.title}</h1>
          <p className="text-muted-foreground text-lg text-pretty">
            {t.description}
          </p>
          {/* Not next-intl's Link: it needs the NextIntlClientProvider context. */}
          <Link
            href="/"
            className={`${buttonVariants({ size: "marketing", tone: "primary" })} mt-4`}
          >
            {t.back}
          </Link>
        </main>
      </ThemeProvider>
    </>
  );
}
