import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { Link } from "@/core/i18n/navigation";
import { SiteFooter } from "@/core/layout/site-footer";
import { SiteHeader } from "@/core/layout/site-header";
import { buttonVariants } from "@/core/ui/button";

/**
 * 标题要写两份——metadata 导出 + React `<title>`——少一份就有一条路径是错的，别删任何一个。
 *
 * - metadata 导出决定**静态 HTML**里的 `<title>`，即关 JS 的浏览器和只抓 HTML 的爬虫看到的
 *   那份。Next 对 not-found 有专门的采集路径：HTTP access fallback 时 errorType 记为
 *   `'not-found'`，按 'not-found' convention 取本文件的导出，并排在 layout 之后覆盖它。
 *   这里不调 buildMetadata（canonical 会指向首页，留待后续任务处理）。
 * - React `<title>` 决定**水合后**的 DOM。404 的 fallback 由 client boundary 渲染，水合时
 *   client 树里只有 layout 那层的元数据，会把 `<title>` 改回站名；组件里再放一个 React
 *   `<title>`，React 会把它插到 head 里已有 title 的前面，浏览器取第一个，标题才对。
 *
 * 无 JS 时这一页 body 是空的（只有一个 `<div hidden>` 空壳）：这是 client 边界的固有
 * 行为，不是模板坏了，上面两项只能修 `<title>`，修不了 body。
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "NotFound" });
  return { title: t("title") };
}

export default function NotFound() {
  const t = useTranslations("NotFound");

  return (
    // 这一页挂在 [locale]/ 下、不在 (marketing) 组里，穿不到营销面的 layout，
    // 所以 Header / Footer 在这里自己渲染一份 —— 404 也得有站内导航，
    // 只有「Back to home」一个出路是不够的。
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="container-marketing flex flex-1 items-center py-14 sm:py-20">
        <div className="max-w-2xl">
          <title>{t("title")}</title>
          {/* 文字用 --primary-text 而不是 --primary：后者保留配置原 hex，
              压在画布上暗色主题里不够看（design.md §2 的颜色分工）。 */}
          <p className="text-primary-text font-mono text-sm font-medium tracking-[0.2em]">
            404
          </p>
          {/* 全站的 h1 都走 display 面，这里以前漏了。 */}
          <h1 className="heading-display mt-4 text-4xl sm:text-5xl">
            {t("title")}
          </h1>
          <p className="text-muted-foreground mt-4 text-lg text-pretty">
            {t("description")}
          </p>
          {/* 营销面的 CTA 是 44px 带唇边的贴纸；默认的 32px 也低于 design.md 的触控目标下限。 */}
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
