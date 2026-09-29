import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { notFound } from "next/navigation";

import { AttributionConsentSlot } from "@/core/acquisition/consent-slot";
import { pickClientMessages } from "@/core/i18n/client-messages";
import { routing } from "@/core/i18n/routing";
import { cn } from "@/core/lib/utils";
import { WebAnalyticsScripts } from "@/core/observability/web-analytics-scripts";
import { JsonLd, siteJsonLd } from "@/core/seo/json-ld";
import { buildMetadata } from "@/core/seo/metadata";
import { brandCss } from "@/core/theme/brand-css";
import { ThemeProvider } from "@/core/theme/theme-provider";
import { Toaster } from "@/core/ui/sonner";

import siteConfig from "../../../site.config";
import "../globals.css";

// Body and UI text: neutral and restrained, so the display face gets to speak on its own.
const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

// Heading font. Chosen over the reference site's Gasoek One: Bricolage's variable weights hold up
// at small sizes too (card titles and plan names use it), so it isn't a display-only face that
// works just for big headlines; and this is a template, so it shouldn't borrow another brand's
// type identity.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
});

// Monospace for the terminal and checkout counter in the mock UI.
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export async function generateMetadata({ params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return buildMetadata({ locale, path: "/", description: t("description") });
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function RootLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const messages = pickClientMessages(await getMessages({ locale }));

  return (
    // next-themes adds a class to <html> on the client, so ignore the hydration mismatch here.
    <html
      lang={locale}
      className={cn(
        "font-sans",
        geist.variable,
        display.variable,
        mono.variable,
      )}
      suppressHydrationWarning
    >
      <head>
        <style>{brandCss(siteConfig.brand)}</style>
      </head>
      <body>
        <JsonLd data={siteJsonLd(locale)} />
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider>
            {children}
            <Toaster />
            <AttributionConsentSlot />
          </ThemeProvider>
        </NextIntlClientProvider>
        <WebAnalyticsScripts />
      </body>
    </html>
  );
}
