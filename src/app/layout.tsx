import type { Metadata } from "next";
import { Geist } from "next/font/google";

import { cn } from "@/core/lib/utils";
import { brandCss } from "@/core/theme/brand-css";
import { ThemeProvider } from "@/core/theme/theme-provider";
import { Toaster } from "@/core/ui/sonner";

import siteConfig from "../../site.config";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: siteConfig.name,
  description: siteConfig.description,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // next-themes 在客户端给 <html> 加 class，需要忽略这一处的 hydration 差异。
    <html
      lang="en"
      className={cn("font-sans", geist.variable)}
      suppressHydrationWarning
    >
      <head>
        <style>{brandCss(siteConfig.brand)}</style>
      </head>
      <body>
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
