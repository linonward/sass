import { Fragment } from "react";

import type { LandingSectionId, SiteConfig } from "@/core/config/schema";

import { bands, type Band } from "./sections/band";
import { Delivery } from "./sections/delivery";
import { Cta } from "./sections/cta";
import { Faq } from "./sections/faq";
import { Features } from "./sections/features";
import { Hero } from "./sections/hero";
import { Pricing } from "./sections/pricing";
import { Testimonials } from "./sections/testimonials";

type Config = Pick<SiteConfig, "landing" | "billing" | "brand">;

type SectionRenderer = (
  config: Config,
  /** 上一段的色带，用来画两段之间的波浪。 */
  waveFrom: Band | undefined,
) => React.ReactNode;

const sections: Record<LandingSectionId, SectionRenderer> = {
  hero: (config, waveFrom) => (
    <Hero
      {...config.landing.hero}
      waveFrom={waveFrom}
      primaryColor={config.brand.primaryColor}
    />
  ),
  features: (config, waveFrom) => (
    <Features items={config.landing.features} waveFrom={waveFrom} />
  ),
  testimonials: (config, waveFrom) => (
    <Testimonials
      items={config.landing.testimonials.items}
      waveFrom={waveFrom}
    />
  ),
  pricing: (config, waveFrom) => (
    <Pricing
      plans={config.billing.plans.filter((plan) => !plan.hidden)}
      currency={config.billing.currency}
      waveFrom={waveFrom}
    />
  ),
  delivery: (config, waveFrom) => {
    // 购买卡片卖的套餐：不存在或被隐藏时传 undefined，卡片退回「即将公布」。
    const plan = config.billing.plans.find(
      (p) => p.id === config.landing.purchasePlan && !p.hidden,
    );
    return (
      <Delivery
        waveFrom={waveFrom}
        plan={plan}
        currency={config.billing.currency}
      />
    );
  },
  faq: (config, waveFrom) => (
    <Faq items={config.landing.faq} waveFrom={waveFrom} />
  ),
  cta: (_config, waveFrom) => <Cta waveFrom={waveFrom} />,
};

/** 按 `landing.sections` 的顺序渲染首页区块。 */
export function Landing({ config }: { config: Config }) {
  // 波浪取决于相邻两段，只能在这里算：区块自己不知道邻居是谁，
  // 而 landing.sections 是可配置的，写死邻居会在调换顺序后画出对不上的波浪。
  // Filter before computing adjacent bands, so an empty wall leaves no phantom wave.
  const visibleSections = config.landing.sections.filter(
    (id) =>
      id !== "testimonials" || config.landing.testimonials.items.length > 0,
  );
  return (
    <div className="landing-page">
      {visibleSections.map((id, index) => {
        // 第一段没有上一段，不画波浪（waveFrom 为 undefined）。
        const previous = visibleSections[index - 1];
        return (
          <Fragment key={id}>
            {sections[id](config, previous ? bands[previous] : undefined)}
          </Fragment>
        );
      })}
    </div>
  );
}
