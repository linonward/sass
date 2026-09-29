import { getTranslations } from "next-intl/server";

import { postParams } from "@/core/blog/pages";
import { getPost } from "@/core/blog/posts";
import { routing } from "@/core/i18n/routing";
import { ogCard } from "@/core/seo/og-card";

import siteConfig from "../../../../../../../site.config";

export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    postParams(locale).map(({ slug }) => ({ locale, slug })),
  );
}

// Per-post share image (1200x630), generated at build time.
export async function GET(
  _request: Request,
  { params }: RouteContext<"/[locale]/blog/[slug]/og">,
) {
  const { locale, slug } = await params;
  const post = getPost(locale, slug);
  if (!post) return new Response("Not Found", { status: 404 });
  const t = await getTranslations({ locale, namespace: "Blog" });
  return ogCard({
    eyebrow: `${siteConfig.name} · ${t("title")}`,
    title: post.title,
  });
}
