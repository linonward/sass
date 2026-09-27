import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { buildMetadata } from "@/core/seo/metadata";
import { localizedPath } from "@/core/seo/urls";

import siteConfig from "../../../site.config";
import {
  changelogEnabled,
  changelogPath,
  feedPath,
  getEntries,
} from "./entries";
import { ChangelogList } from "./entry-list";
import { buildChangelogFeed } from "./rss";

// 以下函数供 src/app/[locale]/(marketing)/changelog/ 下的页面使用，页面文件只负责取 params。

async function changelogTranslations(locale: string) {
  return getTranslations({ locale, namespace: "Changelog" });
}

function feeds(locale: string, title: string) {
  return {
    "application/rss+xml": [{ url: localizedPath(locale, feedPath), title }],
  };
}

// —— 列表页 /changelog ——

export async function changelogMetadata(locale: string) {
  const t = await changelogTranslations(locale);
  return buildMetadata({
    locale,
    path: changelogPath,
    title: t("title"),
    description: t("description"),
    feeds: feeds(locale, t("feedTitle", { name: siteConfig.name })),
  });
}

export function ChangelogPage() {
  if (!changelogEnabled) notFound();
  return <ChangelogList entries={getEntries()} />;
}

// —— RSS /changelog/rss.xml、/<locale>/changelog/rss.xml ——

export async function rssResponse(locale: string) {
  if (!changelogEnabled) return new Response("Not Found", { status: 404 });
  const t = await changelogTranslations(locale);
  const xml = buildChangelogFeed({
    locale,
    title: t("feedTitle", { name: siteConfig.name }),
    description: t("description"),
    entries: getEntries(),
  });
  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
