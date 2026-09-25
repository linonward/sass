import { Fragment } from "react";

import type { LandingSectionId, SiteConfig } from "@/core/config/schema";

import { Cta } from "./sections/cta";
import { Faq } from "./sections/faq";
import { Features } from "./sections/features";
import { Hero } from "./sections/hero";
import { Pricing } from "./sections/pricing";

type Config = Pick<SiteConfig, "landing" | "billing">;

const sections: Record<LandingSectionId, (config: Config) => React.ReactNode> =
  {
    hero: ({ landing }) => <Hero {...landing.hero} />,
    features: ({ landing }) => <Features items={landing.features} />,
    pricing: ({ billing }) => (
      <Pricing plans={billing.plans} currency={billing.currency} />
    ),
    faq: ({ landing }) => <Faq items={landing.faq} />,
    cta: () => <Cta />,
  };

/** 按 `landing.sections` 的顺序渲染首页区块。 */
export function Landing({ config }: { config: Config }) {
  return config.landing.sections.map((id) => (
    <Fragment key={id}>{sections[id](config)}</Fragment>
  ));
}
