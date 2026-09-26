import { Fragment } from "react";

import type { LandingSectionId, SiteConfig } from "@/core/config/schema";

import { bands, type Band } from "./sections/band";
import { Cta } from "./sections/cta";
import { Faq } from "./sections/faq";
import { Features } from "./sections/features";
import { Hero } from "./sections/hero";
import { Pricing } from "./sections/pricing";

type Config = Pick<SiteConfig, "landing" | "billing">;

type SectionRenderer = (
  config: Config,
  /** 上一段的色带，用来画两段之间的波浪。 */
  waveFrom: Band | undefined,
) => React.ReactNode;

/** hero 的拼贴 mock 展示真实的高亮套餐，而不是编的假数据。 */
function highlightPlan(config: Config) {
  const { plans } = config.billing;
  return plans.find((plan) => plan.highlighted) ?? plans[0];
}

const sections: Record<LandingSectionId, SectionRenderer> = {
  hero: (config, waveFrom) => (
    <Hero
      {...config.landing.hero}
      waveFrom={waveFrom}
      plan={highlightPlan(config)}
      currency={config.billing.currency}
    />
  ),
  features: (config, waveFrom) => (
    <Features items={config.landing.features} waveFrom={waveFrom} />
  ),
  pricing: (config, waveFrom) => (
    <Pricing
      plans={config.billing.plans}
      currency={config.billing.currency}
      waveFrom={waveFrom}
    />
  ),
  faq: (config, waveFrom) => (
    <Faq items={config.landing.faq} waveFrom={waveFrom} />
  ),
  cta: (_config, waveFrom) => <Cta waveFrom={waveFrom} />,
};

/** 按 `landing.sections` 的顺序渲染首页区块。 */
export function Landing({ config }: { config: Config }) {
  // 波浪取决于相邻两段，只能在这里算：区块自己不知道邻居是谁，
  // 而 landing.sections 是可配置的，写死邻居会在调换顺序后画出对不上的波浪。
  return config.landing.sections.map((id, index) => (
    <Fragment key={id}>
      {sections[id](config, bands[config.landing.sections[index - 1]])}
    </Fragment>
  ));
}
