import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
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

// 正文与界面文字：中性、克制，让 display 面单独发声。
const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

// 标题字体。选它而不是参考站点的 Gasoek One：Bricolage 的可变字重让它在小字号
// 也撑得住（卡片标题、套餐名都要用），不是只能看大标题的纯 display 面；
// 而且它是模板，不该直接套另一个品牌的字体身份。
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
});

// mock UI 里的终端和结账台用等宽字体。
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
    // next-themes 在客户端给 <html> 加 class，需要忽略这一处的 hydration 差异。
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
          </ThemeProvider>
        </NextIntlClientProvider>
        <WebAnalyticsScripts />
      </body>
    </html>
  );
}
