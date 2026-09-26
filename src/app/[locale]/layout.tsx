import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { Geist } from "next/font/google";
import { notFound } from "next/navigation";

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

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

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
    // next-themes 在客户端给 <html> 加 class，需要忽略这一处的 hydration 差异。
    <html
      lang={locale}
      className={cn("font-sans", geist.variable)}
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
          </ThemeProvider>
        </NextIntlClientProvider>
        <WebAnalyticsScripts />
      </body>
    </html>
  );
}
