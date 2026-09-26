import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { Link } from "@/core/i18n/navigation";
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
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <title>{t("title")}</title>
      <p className="text-primary text-sm font-medium">404</p>
      <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-muted-foreground">{t("description")}</p>
      <Link href="/" className={buttonVariants()}>
        {t("back")}
      </Link>
    </main>
  );
}
