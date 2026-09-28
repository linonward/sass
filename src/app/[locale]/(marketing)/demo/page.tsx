import { getFormatter } from "next-intl/server";

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
import { cn } from "@/core/lib/utils";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/demo">) {
  const { locale } = await params;
  return buildMetadata({
    locale,
    path: "/demo",
    title: "Demo — see what your SaaS looks like inside",
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
  const format = await getFormatter({ locale });

  const newUsers = mockDailyPoints(14, 12);
  const aiCalls = mockDailyPoints(14, 240);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Your SaaS dashboard"
        description="This is what your users and admin see. All of it ships with the template — you just change one hex color."
      />

      <MetricSection
        title="30-day overview"
        description="Same metric cards your admin panel shows. Real numbers once you launch."
      >
        <StatGrid>
          <StatTile
            label="New users"
            value={format.number(1247)}
            hint="Last 30 days"
          />
          <StatTile
            label="Net revenue"
            value={`$${format.number(4580)}`}
            hint="Last 30 days, after refunds"
          />
          <StatTile
            label="Credits issued"
            value={format.number(89200)}
            hint="All time"
          />
          <StatTile
            label="AI calls"
            value={format.number(6842)}
            hint="Last 30 days"
          />
        </StatGrid>
      </MetricSection>

      <ChartGrid>
        <DailyColumns
          title="New users per day"
          points={newUsers}
          formatValue={(v) => format.number(v)}
          formatDay={(d) => d.slice(5)}
        />
        <DailyColumns
          title="AI calls per day"
          points={aiCalls}
          formatValue={(v) => format.number(v)}
          formatDay={(d) => d.slice(5)}
        />
      </ChartGrid>

      <MetricSection
        title="Everything included"
        description="All of these ship with the template. No plugins, no separate purchases."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              key: "auth",
              title: "Auth & email verification",
              desc: "Better Auth with 6-digit email codes. No magic links.",
            },
            {
              key: "billing",
              title: "Creem payments (MoR)",
              desc: "Accept global payments without a company entity.",
            },
            {
              key: "ai",
              title: "AI with usage billing",
              desc: "Pre-authorize credits, atomic deduction, refund on failure.",
            },
            {
              key: "acquisition",
              title: "Acquisition tools",
              desc: "UTM attribution, waitlist, referral rewards — all built in.",
            },
            {
              key: "brand",
              title: "One-hex rebrand",
              desc: "Change one color in config — the entire site rebrands.",
            },
            {
              key: "i18n",
              title: "i18n ready",
              desc: "Add a language file and it just works.",
            },
          ].map((mod) => (
            <div key={mod.key} className="panel flex flex-col gap-2 p-4">
              <h3 className="heading-display text-sm">{mod.title}</h3>
              <p className="text-muted-foreground text-xs">{mod.desc}</p>
            </div>
          ))}
        </div>
      </MetricSection>

      <div className="bg-primary-band sticker flex flex-col items-center gap-4 rounded-xl px-6 py-10 text-center">
        <h2 className="heading-display text-2xl">
          Fork it. Deploy it. Ship it.
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm">
          One click deploys to Vercel with a Neon Postgres database. Change the
          config, commit, and your SaaS is live.
        </p>
        <a
          href="https://vercel.com/new/clone?repository-url=https://github.com/linonward/sass"
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ size: "marketing", tone: "primary" }))}
        >
          Deploy to Vercel
        </a>
      </div>
    </div>
  );
}
