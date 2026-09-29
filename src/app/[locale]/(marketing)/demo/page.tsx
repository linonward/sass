import { getFormatter, getTranslations } from "next-intl/server";

import { buildMetadata } from "@/core/seo/metadata";
import { PageHeader } from "@/core/ui/page-header";
import {
  ChartGrid,
  DailyColumns,
  MetricSection,
  StatGrid,
  StatTile,
} from "@/core/admin/ui/metrics";
import { buttonVariants } from "@/core/ui/button";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/demo">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Demo" });
  return buildMetadata({
    locale,
    path: "/demo",
    title: t("metaTitle"),
    noIndex: true,
  });
}

function mockDailyPoints(days: number, avg: number) {
  const now = new Date();
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (days - 1 - i));
    const dow = d.getDay();
    const weekend = dow === 0 || dow === 6 ? 0.5 : 1;
    const jitter = 0.7 + Math.random() * 0.6;
    return {
      day: d.toISOString().slice(0, 10),
      value: Math.round(avg * weekend * jitter),
    };
  });
}

export default async function DemoPage({
  params,
}: PageProps<"/[locale]/demo">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Demo" });
  const format = await getFormatter({ locale });

  const newUsers = mockDailyPoints(14, 12);
  const aiCalls = mockDailyPoints(14, 240);

  const modules = [
    { key: "auth" as const },
    { key: "billing" as const },
    { key: "ai" as const },
    { key: "acquisition" as const },
    { key: "brand" as const },
    { key: "i18n" as const },
  ];

  return (
    <div className="container-marketing flex flex-col gap-8 py-14 sm:py-20">
      <PageHeader title={t("pageTitle")} description={t("pageDescription")} />

      <MetricSection
        title={t("overview.title")}
        description={t("overview.description")}
      >
        <StatGrid>
          <StatTile
            label={t("stats.newUsers.label")}
            value={format.number(1247)}
            hint={t("stats.newUsers.hint")}
          />
          <StatTile
            label={t("stats.netRevenue.label")}
            value={`$${format.number(4580)}`}
            hint={t("stats.netRevenue.hint")}
          />
          <StatTile
            label={t("stats.creditsIssued.label")}
            value={format.number(89200)}
            hint={t("stats.creditsIssued.hint")}
          />
          <StatTile
            label={t("stats.aiCalls.label")}
            value={format.number(6842)}
            hint={t("stats.aiCalls.hint")}
          />
        </StatGrid>
      </MetricSection>

      <ChartGrid>
        <DailyColumns
          title={t("chartNewUsers")}
          points={newUsers}
          formatValue={(v) => format.number(v)}
          formatDay={(d) => d.slice(5)}
        />
        <DailyColumns
          title={t("chartAiCalls")}
          points={aiCalls}
          formatValue={(v) => format.number(v)}
          formatDay={(d) => d.slice(5)}
        />
      </ChartGrid>

      <MetricSection
        title={t("everything.title")}
        description={t("everything.description")}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((mod) => (
            <div key={mod.key} className="panel flex flex-col gap-2 p-4">
              <h3 className="heading-display text-sm">
                {t(`modules.${mod.key}.title` as never)}
              </h3>
              <p className="text-muted-foreground text-xs">
                {t(`modules.${mod.key}.desc` as never)}
              </p>
            </div>
          ))}
        </div>
      </MetricSection>

      <div className="bg-primary-band sticker flex flex-col items-center gap-4 rounded-xl px-6 py-10 text-center">
        <h2 className="heading-display text-2xl">{t("ctaTitle")}</h2>
        <p className="text-muted-foreground max-w-prose text-sm">
          {t("ctaDescription")}
        </p>
        <a
          href="https://vercel.com/new/clone?repository-url=https://github.com/linonward/sass"
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ size: "marketing", tone: "primary" })}
        >
          {t("deployButton")}
        </a>
      </div>
    </div>
  );
}
