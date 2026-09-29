import { listedPlans } from "@/core/billing/plans";
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

// llms.txt is a single root-level file (by convention), so it always uses the default locale — a
// multilingual site still has just one, with the default locale's canonical paths. Paths with an
// extension skip the proxy and are never rewritten under [locale]. All content comes from config,
// messages and build-time blog data, so it can be fixed at build time.
export const dynamic = "force-static";

const locale = routing.defaultLocale;

/**
 * Plan price. Same options as the marketing pricing section (whole numbers without decimals), so the
 * numbers never disagree between the two.
 */
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
  // id / key come from config, and the messages tests guarantee they exist (same pattern as the
  // marketing pricing section).
  const planName = (id: string) => tp(`plans.${id}.name` as "plans.free.name");
  const feature = (key: string) =>
    tp(`features.${key}` as "features.credits100");

  // Paths that need an account: everything in the sidebar (kit items + your items + the admin
  // entry) plus the sign-in page itself.
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
        // marketingRoutes is the registry of public pages (the sitemap uses it too). Any registered
        // page shows up here; pages without their own copy use the path as the title.
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
      items: listedPlans().map((plan) => ({
        title: `${planName(plan.id)} — ${money(plan.price)} ${tp(`interval.${plan.interval}`)}${plan.highlighted ? ` (${tp("popular")})` : ""}`,
        url: url("/pricing"),
        note: plan.features.map(feature).join(", "),
      })),
    },
    /*
     * Blog: the index page plus the latest few posts. Listing every post would bloat this file as
     * content grows, and sitemap.xml already provides the full list.
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
      // Plain-text lines: these paths have no crawlable content, and links would mislead agents.
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
