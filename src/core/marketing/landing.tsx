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
import { TimeSaved } from "./sections/timesaved";

type Config = Pick<SiteConfig, "landing" | "billing" | "brand">;

/** The plan sold by the purchase card: undefined when missing or hidden, and everything falls back to "coming soon" / the demo. */
function purchasePlan(config: Config) {
  return config.billing.plans.find(
    (p) => p.id === config.landing.purchasePlan && !p.hidden,
  );
}

type SectionRenderer = (
  config: Config,
  /** The previous section's band, used to draw the wave between the two. */
  waveFrom: Band | undefined,
) => React.ReactNode;

const sections: Record<LandingSectionId, SectionRenderer> = {
  hero: (config, waveFrom) => (
    <Hero
      {...config.landing.hero}
      waveFrom={waveFrom}
      primaryColor={config.brand.primaryColor}
      plan={purchasePlan(config)}
      currency={config.billing.currency}
      showcaseUrl={config.landing.showcaseUrl}
    />
  ),
  timesaved: (config, waveFrom) => (
    <TimeSaved items={config.landing.timeSaved} waveFrom={waveFrom} />
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
  delivery: (config, waveFrom) => (
    <Delivery
      waveFrom={waveFrom}
      plan={purchasePlan(config)}
      currency={config.billing.currency}
    />
  ),
  faq: (config, waveFrom) => (
    <Faq items={config.landing.faq} waveFrom={waveFrom} />
  ),
  cta: (config, waveFrom) => (
    <Cta
      waveFrom={waveFrom}
      plan={purchasePlan(config)}
      currency={config.billing.currency}
      showcaseUrl={config.landing.showcaseUrl}
    />
  ),
};

/** Renders the home page sections in `landing.sections` order. */
export function Landing({ config }: { config: Config }) {
  // The wave depends on both adjacent sections, so it can only be computed here: a section doesn't
  // know its neighbors, and landing.sections is configurable, so hard-coding neighbors would draw
  // mismatched waves after a reorder.
  // Filter before computing adjacent bands, so an empty wall leaves no phantom wave.
  const visibleSections = config.landing.sections.filter(
    (id) =>
      (id !== "testimonials" || config.landing.testimonials.items.length > 0) &&
      (id !== "timesaved" || config.landing.timeSaved.length > 0),
  );
  return (
    <div className="landing-page">
      {visibleSections.map((id, index) => {
        // The first section has no predecessor, so no wave (waveFrom is undefined).
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
