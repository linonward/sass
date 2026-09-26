import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";

import { routing } from "@/core/i18n/routing";
import { cn } from "@/core/lib/utils";
import { brandCss } from "@/core/theme/brand-css";
import { ThemeProvider } from "@/core/theme/theme-provider";
import { buttonVariants } from "@/core/ui/button";

import siteConfig from "../../site.config";
import "./globals.css";

// 根级 404：接住「页面渲染不出来」的那些路径。
//
// 为什么需要它：src/proxy.ts 的 matcher 跳过了带点的路径和 /api，这些请求不会被
// next-intl 重写成 /<locale>/...，而是由 [locale] 动态段整个吞掉（/missing.png 的
// locale 就是 "missing.png"）。[locale]/layout.tsx 的 hasLocale 校验失败后在那里抛
// notFound()，而同段的 not-found.tsx 是那个 layout 的子节点，接不到 —— 于是退化成
// 框架内置的默认 404 页（品牌色、主题、本地化、「回首页」全丢）。把文件放在 app 根
// 下，它才是那个 layout 的父级边界。
//
// 实测要点（详见 docs/tasks/phase-9-boundaries.md 与 PR 说明）：
// 1. 这条路径不需要 experimental.globalNotFound —— 根级 not-found.tsx 就够了，
//    且它渲染进的是框架给的 <html id="__next_error__"> 文档，不能再套 <html>。
// 2. 这个文件会被预渲染进**每个页面**的 RSC payload（客户端 notFound 要用），
//    所以它不能碰任何「请求作用域」的 next-intl API：这条路径的 request locale
//    是坏的，next-intl 的 getConfig()（getMessages / useTranslations / 连
//    NextIntlClientProvider 都会经它取 now、timeZone）会回落到 rootParams.locale()
//    —— 于是 src/core/i18n/request.ts:12 再抛一次 notFound()，边界内容变成 error
//    行，整页空白（生产环境实测就是这个现象）。所以这里只用默认语言的文案：
//    照 request.ts 的写法直接读 messages/<defaultLocale>.json，绕开请求配置。
//
// 本地化文案的内联导致这里和 [locale]/not-found.tsx 有一小段重复 —— 那个文件是
// layout 的子节点、走 useTranslations，两边的运行环境不同，共用不了。

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
});
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export default async function RootNotFound() {
  // 这条路径没有语言前缀（/missing.png 这种），用默认语言。
  const locale = routing.defaultLocale;
  const messages = (await import(`../../messages/${locale}.json`)).default;
  const t = messages.NotFound;

  return (
    <>
      {/* [locale]/layout.tsx 注入的品牌色变量在这条路径上不存在，自己补一份。
          这里在客户端边界内，<style> 必须给 href + precedence（React 只 hoist 带
          precedence 的样式），否则客户端渲染时直接抛错。 */}
      <style href="brand-colors" precedence="high">
        {brandCss(siteConfig.brand)}
      </style>
      {/* 同理，layout 里挂到 <html> 上的字体变量和不在这里，挂在自己的容器上。
          font-sans 也一并加上：globals.css 的 html { @apply font-sans } 依赖那组
          变量，这条路径的 <html> 上没有。 */}
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
          {/* 和 [locale]/not-found.tsx 同一套语域：文字用 --primary-text 而不是
              --primary（后者是配置原 hex，暗色画布上不够看），h1 走 display 面，
              CTA 用营销面的 44px 贴纸按钮。这条路径穿不到营销面 layout，所以没有
              Header / Footer —— 只接 /missing.png 这类带扩展名的请求。 */}
          <p className="text-primary-text font-mono text-sm font-medium tracking-[0.2em]">
            404
          </p>
          <h1 className="heading-display text-4xl sm:text-5xl">{t.title}</h1>
          <p className="text-muted-foreground text-lg text-pretty">
            {t.description}
          </p>
          {/* 不用 next-intl 的 Link：它要 NextIntlClientProvider 的 context。 */}
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
