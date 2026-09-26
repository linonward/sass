import { getTranslations } from "next-intl/server";

import { adminEnabled } from "@/core/admin";
import { SIGN_IN_PATH } from "@/core/auth/routes";
import {
  blogEnabled,
  blogPath,
  feedPath,
  getPosts,
  getTags,
  postPath,
  tagPath,
} from "@/core/blog/posts";
import { adminEntryNav, dashboardNav } from "@/core/dashboard/nav";
import { routing } from "@/core/i18n/routing";
import { legalPages } from "@/core/legal/pages";
import { buildLlmsTxt, type LlmsSection } from "@/core/seo/llms";
import { marketingRoutes } from "@/core/seo/routes";
import { absoluteUrl, siteUrl } from "@/core/seo/urls";

import siteConfig from "../../../site.config";

// llms.txt 是根级的单文件（约定如此），所以固定用默认语言 —— 多语言站点也只有一个，
// 用默认语言的 canonical 路径。带扩展名的路径不经过 proxy，不会被改写到 [locale] 下。
// 内容全部来自配置、文案和构建期的博客数据，所以可以在构建时就定下来。
export const dynamic = "force-static";

const locale = routing.defaultLocale;

/** 套餐价格。选项和营销页的定价区一致（整数不带小数位），数字才不会两边对不上。 */
function money(amount: number) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: siteConfig.billing.currency,
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}

export async function GET() {
  const t = await getTranslations({ locale, namespace: "Llms" });
  const tn = await getTranslations({ locale, namespace: "Nav" });
  const tp = await getTranslations({ locale, namespace: "Landing.pricing" });
  const url = (path: string) => absoluteUrl(locale, path);
  // id / key 来自配置，由 messages 测试保证存在（和营销页的定价区同一个写法）。
  const planName = (id: string) => tp(`plans.${id}.name` as "plans.free.name");
  const feature = (key: string) =>
    tp(`features.${key}` as "features.credits100");

  // 需要账号的路径：侧边栏里那些（套件项 + 业务项 + 后台入口）外加登录页本身。
  const { suite, business } = dashboardNav(siteConfig);
  const authPaths = [
    SIGN_IN_PATH,
    ...[...suite, ...business].map((item) => item.href),
    ...(adminEnabled ? [adminEntryNav.href] : []),
  ].filter((path, index, all) => all.indexOf(path) === index);

  const legalPaths: readonly string[] = Object.values(legalPages);
  const legalKeys = Object.keys(legalPages) as (keyof typeof legalPages)[];

  const sections: LlmsSection[] = [
    {
      title: t("howToUse"),
      items: [{ title: t("howToUseSitemap") }, { title: t("howToUseAuth") }],
    },
    {
      title: tn("product"),
      items: [
        { title: t("homeTitle"), url: url("/"), note: t("homeNote") },
        { title: tn("pricing"), url: url("/pricing"), note: t("pricingNote") },
        ...(blogEnabled
          ? [{ title: tn("blog"), url: url(blogPath), note: t("blogNote") }]
          : []),
        // marketingRoutes 是「公开页面」的登记处（sitemap 也用这份）。新增页面只要登记过
        // 就会出现在这里，没有单独文案的就用路径当标题。
        ...marketingRoutes
          .filter(
            (path) =>
              path !== "/" && path !== "/pricing" && !legalPaths.includes(path),
          )
          .map((path) => ({ title: path, url: url(path) })),
      ],
    },
    {
      title: tn("pricing"),
      note: t("pricingNote"),
      items: siteConfig.billing.plans.map((plan) => ({
        title: `${planName(plan.id)} — ${money(plan.price)} ${tp(`interval.${plan.interval}`)}${plan.highlighted ? ` (${tp("popular")})` : ""}`,
        url: url("/pricing"),
        note: plan.features.map(feature).join(", "),
      })),
    },
    /*
     * 博客：列表页 + 最新几篇。全站文章都列进来的话这份文件会随内容一起膨胀，
     * 而 sitemap.xml 已经能给出完整清单。
     */
    ...(blogEnabled
      ? [
          {
            title: tn("blog"),
            items: getPosts(locale, { drafts: false })
              .slice(0, 10)
              .map((post) => ({
                title: post.title,
                url: url(postPath(post.slug)),
                note: post.date,
              })),
          },
        ]
      : []),
    {
      title: tn("legal"),
      items: legalKeys.map((key) => ({
        title: tn(key),
        url: url(legalPages[key]),
      })),
    },
    {
      title: t("machineReadable"),
      items: [
        {
          title: "sitemap.xml",
          url: `${siteUrl}/sitemap.xml`,
          note: t("sitemapNote"),
        },
        {
          title: "robots.txt",
          url: `${siteUrl}/robots.txt`,
          note: t("robotsNote"),
        },
        ...(blogEnabled
          ? [
              {
                title: "RSS",
                url: url(feedPath),
                note: t("feedNote"),
              },
            ]
          : []),
      ],
    },
    {
      title: t("auth"),
      note: t("authNote"),
      // 纯文字行：这些路径抓不到内容，写成链接会误导 agent。
      items: authPaths.map((path) => ({ title: path })),
    },
  ];

  const tags = blogEnabled ? getTags(locale) : [];

  const body = buildLlmsTxt({
    name: siteConfig.name,
    summary: siteConfig.description,
    intro: t("intro", { name: siteConfig.name }),
    sections,
    optional:
      tags.length > 0
        ? {
            title: t("optional"),
            note: t("tagsNote"),
            items: tags.map((tag) => ({ title: tag, url: url(tagPath(tag)) })),
          }
        : undefined,
  });

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
