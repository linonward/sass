import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { Geist } from "next/font/google";
import { notFound } from "next/navigation";

import { routing } from "@/core/i18n/routing";
import { cn } from "@/core/lib/utils";
import { brandCss } from "@/core/theme/brand-css";
import { ThemeProvider } from "@/core/theme/theme-provider";
import { Toaster } from "@/core/ui/sonner";

import siteConfig from "../../../site.config";
import "../globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: siteConfig.name,
  description: siteConfig.description,
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function RootLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

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
        <NextIntlClientProvider>
          <ThemeProvider>
            {children}
            <Toaster />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
