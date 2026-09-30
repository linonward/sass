import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test } from "vitest";

import { defineConfig, type SiteConfigInput } from "@/core/config/schema";

import { withOverlay, withOverlayMessages } from "@/core/config/overlay";

import messages from "../../../messages/en.json";
import siteConfig from "../../../site.config";
import { Landing } from "./landing";

// The optional sections' example keys shipped in messages (off in the default config).
const exampleTimeSaved = [
  { key: "studio", hours: 4 },
  { key: "shoot", hours: 3 },
  { key: "retouch", hours: 2 },
];
const exampleDeliverables = ["credits", "commercial", "support"];

function renderSections(sections: string[]) {
  const config = defineConfig({
    ...siteConfig,
    landing: {
      ...siteConfig.landing,
      sections,
      timeSaved: exampleTimeSaved,
      deliverables: exampleDeliverables,
    },
  } as SiteConfigInput);
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Landing config={config} />
    </NextIntlClientProvider>,
  ).container;
}

function sectionIds(container: HTMLElement) {
  return [...container.querySelectorAll("[data-section]")].map((el) =>
    el.getAttribute("data-section"),
  );
}

describe("Landing", () => {
  test("renders every section in config order", () => {
    expect(
      sectionIds(
        renderSections([
          "hero",
          "features",
          "delivery",
          "pricing",
          "faq",
          "cta",
        ]),
      ),
    ).toEqual(["hero", "features", "delivery", "pricing", "faq", "cta"]);
  });

  test("render order follows a reordered config", () => {
    expect(sectionIds(renderSections(["faq", "hero", "cta"]))).toEqual([
      "faq",
      "hero",
      "cta",
    ]);
  });

  test("removed sections are no longer rendered", () => {
    const rendered = sectionIds(
      renderSections(["hero", "features", "faq", "cta"]),
    );
    expect(rendered).not.toContain("pricing");
  });

  test("renders no sections for an empty array", () => {
    expect(sectionIds(renderSections([]))).toEqual([]);
  });

  // When next-intl hits a missing key or an ICU message it can't parse, it renders the raw key on
  // the page. That kind of error only shows up in a real render: copy with braces like
  // `{ model, credits }` fails to parse as ICU placeholders, and this test is what catches it.
  test("all messages resolve, with no raw keys leaking through", () => {
    const { textContent } = renderSections([
      "hero",
      "timesaved",
      "features",
      "pricing",
      "delivery",
      "faq",
      "cta",
    ]);
    expect(textContent).not.toMatch(/Landing\.[A-Za-z]/);
  });
});

type PlansInput = NonNullable<NonNullable<SiteConfigInput["billing"]>["plans"]>;

describe("delivery section purchase card", () => {
  function renderDelivery(plans?: (plans: PlansInput) => PlansInput) {
    const input = siteConfig as SiteConfigInput;
    const config = defineConfig({
      ...input,
      billing: {
        ...input.billing,
        plans: plans ? plans(input.billing?.plans ?? []) : input.billing?.plans,
      },
      landing: {
        ...input.landing,
        sections: ["delivery"],
        purchasePlan: "lifetime",
        deliverables: exampleDeliverables,
      },
    } as SiteConfigInput);
    return render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Landing config={config} />
      </NextIntlClientProvider>,
    );
  }

  test("shows the purchasePlan price, terms, and buy button", () => {
    const view = renderDelivery((plans) =>
      plans.map((p) => (p.id === "lifetime" ? { ...p, price: 99 } : p)),
    );
    const offer = view.getByTestId("delivery-offer");
    expect(offer.textContent).toContain("$99");
    expect(offer.textContent).toContain(messages.Landing.pricing.interval.once);
    expect(offer.textContent).toContain(messages.Landing.delivery.terms);
    expect(
      view.getByRole("button", { name: messages.Landing.delivery.buy }),
    ).toBeDefined();
    const listed = [...view.container.querySelectorAll("#delivery dt")].map(
      (dt) => dt.textContent,
    );
    expect(listed).toEqual(
      exampleDeliverables.map(
        (key) =>
          messages.Landing.delivery.items[
            key as keyof typeof messages.Landing.delivery.items
          ].title,
      ),
    );
    // The demo link only appears when landing.demo is on.
    expect(
      view.queryByRole("link", { name: messages.Landing.delivery.demo }),
    ).toBeNull();
  });

  test('falls back to "coming soon" with no buy button when the plan is hidden or missing', () => {
    for (const plans of [
      (all: PlansInput) =>
        all.map((p) => (p.id === "lifetime" ? { ...p, hidden: true } : p)),
      (all: PlansInput) => all.filter((p) => p.id !== "lifetime"),
    ]) {
      const view = renderDelivery(plans);
      expect(view.queryByTestId("delivery-offer")).toBeNull();
      expect(view.container.textContent).toContain(
        messages.Landing.delivery.pending,
      );
      expect(
        view.queryByRole("button", { name: messages.Landing.delivery.buy }),
      ).toBeNull();
      view.unmount();
    }
  });
});

describe("landing / billing config", () => {
  test.each([
    ["landing.sections.1", { landing: { sections: ["hero", "blog"] } }],
    ["landing.sections", { landing: { sections: ["hero", "hero"] } }],
    [
      "landing.features.0.icon",
      { landing: { features: [{ key: "a", icon: "rocket" }] } },
    ],
    [
      "billing.plans",
      {
        billing: {
          plans: [
            { id: "pro", price: 1, interval: "month", features: ["a"] },
            { id: "pro", price: 2, interval: "month", features: ["a"] },
          ],
        },
      },
    ],
    [
      "billing.plans.0.interval",
      {
        billing: {
          plans: [{ id: "pro", price: 1, interval: "week", features: ["a"] }],
        },
      },
    ],
    ["billing.currency", { billing: { currency: "usd" } }],
  ])("invalid field %s appears in the error", (path, patch) => {
    expect(() =>
      defineConfig({ ...siteConfig, ...patch } as SiteConfigInput),
    ).toThrow(`- ${path}: `);
  });
});

describe("hero and closing buttons", () => {
  function renderWith({
    purchasePlan,
    hidden = false,
    demo = false,
    showcaseUrl,
    sections = ["hero", "cta"],
    colorSwitcher,
  }: {
    purchasePlan?: string;
    hidden?: boolean;
    demo?: boolean;
    showcaseUrl?: string;
    sections?: string[];
    colorSwitcher?: boolean;
  } = {}) {
    const input = siteConfig as SiteConfigInput;
    const config = defineConfig({
      ...input,
      billing: {
        ...input.billing,
        plans: input.billing?.plans?.map((p) =>
          p.id === "lifetime" ? { ...p, price: 99, hidden } : p,
        ),
      },
      landing: {
        ...input.landing,
        sections,
        purchasePlan,
        demo,
        showcaseUrl,
        hero: { ...input.landing?.hero, colorSwitcher },
      },
    } as SiteConfigInput);
    return render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Landing config={config} />
      </NextIntlClientProvider>,
    );
  }
  const t = messages.Landing;
  const hrefs = (view: ReturnType<typeof renderWith>, name: string | RegExp) =>
    view.getAllByRole("link", { name }).map((a) => a.getAttribute("href"));

  test("product site (the default): get started leads to sign-in, the secondary button to pricing", () => {
    const view = renderWith();
    expect(hrefs(view, t.hero.startCta)).toEqual([
      expect.stringMatching(/\/sign-in$/),
      expect.stringMatching(/\/sign-in$/),
    ]);
    // Without a pricing section on the page, the secondary button opens the pricing page.
    expect(hrefs(view, t.hero.pricingCta)).toEqual([
      expect.stringMatching(/\/pricing$/),
      expect.stringMatching(/\/pricing$/),
    ]);
    expect(view.queryByRole("link", { name: t.hero.demoCta })).toBeNull();
    expect(view.queryByText(t.hero.offerNote)).toBeNull();
  });

  test("with a pricing section on the page, the secondary button jumps to it", () => {
    const view = renderWith({ sections: ["hero", "pricing", "cta"] });
    for (const href of hrefs(view, t.hero.pricingCta)) {
      expect(href).toMatch(/#pricing$/);
    }
  });

  test('with a purchasable plan: the primary button is "Buy now · price" and jumps to the delivery purchase card', () => {
    const view = renderWith({ purchasePlan: "lifetime", demo: true });
    const buy = hrefs(view, "Buy now · $99");
    expect(buy).toHaveLength(2);
    for (const href of buy) expect(href).toMatch(/#delivery$/);
    expect(view.getByText(t.hero.offerNote)).toBeDefined();
    // With landing.demo on and no real showcase, the secondary button is the in-site demo.
    for (const href of hrefs(view, t.hero.demoCta)) {
      expect(href).toMatch(/\/demo$/);
    }
  });

  test("with showcaseUrl set: the secondary button opens the real showcase in a new tab", () => {
    const view = renderWith({
      purchasePlan: "lifetime",
      demo: true,
      showcaseUrl: "https://shots.example.com",
    });
    for (const link of view.getAllByRole("link", {
      name: t.hero.showcaseCta,
    })) {
      expect(link.getAttribute("href")).toBe("https://shots.example.com");
      expect(link.getAttribute("target")).toBe("_blank");
    }
    expect(view.queryByRole("link", { name: t.hero.demoCta })).toBeNull();
  });

  test("with the plan hidden: falls back to the demo when landing.demo is on, with no price note", () => {
    const view = renderWith({
      purchasePlan: "lifetime",
      hidden: true,
      demo: true,
      sections: ["hero", "delivery", "cta"],
    });
    expect(view.queryByRole("link", { name: /Buy now/ })).toBeNull();
    expect(view.queryByText(t.hero.offerNote)).toBeNull();
    for (const href of hrefs(view, t.hero.demoCta)) {
      expect(href).toMatch(/\/demo$/);
    }
    for (const href of hrefs(view, t.hero.deliveryCta)) {
      expect(href).toMatch(/#delivery$/);
    }
  });

  test("the brand color switcher only shows when hero.colorSwitcher is on", () => {
    const label = t.hero.colorSwitcher.label;
    const off = renderWith();
    expect(off.queryByRole("radiogroup", { name: label })).toBeNull();
    off.unmount();
    const on = renderWith({ colorSwitcher: true });
    expect(on.getByRole("radiogroup", { name: label })).toBeDefined();
  });

  test("showcaseUrl only accepts https", () => {
    expect(() =>
      defineConfig({
        ...(siteConfig as SiteConfigInput),
        landing: {
          ...siteConfig.landing,
          showcaseUrl: "http://shots.example.com",
        },
      } as SiteConfigInput),
    ).toThrow(/showcaseUrl/);
  });
});

describe("time saved", () => {
  function renderTimeSaved(timeSaved: { key: string; hours: number }[]) {
    const config = defineConfig({
      ...siteConfig,
      landing: {
        ...siteConfig.landing,
        sections: ["hero", "timesaved", "features"],
        timeSaved,
      },
    } as SiteConfigInput);
    return render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Landing config={config} />
      </NextIntlClientProvider>,
    );
  }

  test("lists hours per item and computes the total", () => {
    const view = renderTimeSaved(exampleTimeSaved);
    const items = view.container.querySelectorAll("#timesaved li");
    expect(items).toHaveLength(exampleTimeSaved.length);
    const total = exampleTimeSaved.reduce((n, i) => n + i.hours, 0);
    expect(view.getByTestId("timesaved-total").textContent).toContain(
      `${total} hours`,
    );
  });

  test("does not render the section for an empty list", () => {
    const view = renderTimeSaved([]);
    expect(sectionIds(view.container)).toEqual(["hero", "features"]);
  });

  test("every key in config exists in both the English and Chinese messages", async () => {
    const zh = (await import("../../../messages/zh.json")).default;
    for (const { key } of exampleTimeSaved) {
      for (const m of [messages, zh]) {
        expect(
          m.Landing.timesaved.items[
            key as keyof typeof m.Landing.timesaved.items
          ],
        ).toBeDefined();
      }
    }
    for (const key of siteConfig.landing.faq) {
      for (const m of [messages, zh]) {
        expect(
          m.Landing.faq.items[key as keyof typeof m.Landing.faq.items],
        ).toBeDefined();
      }
    }
  });
});

// A deployment's own home page (SITE_OVERLAY_DIR, see core/config/overlay.ts) is checked when the
// variable is set: run `SITE_OVERLAY_DIR=<dir> pnpm test src/core/marketing` after editing it.
describe.skipIf(!process.env.SITE_OVERLAY_DIR)(
  "home page with the SITE_OVERLAY_DIR overlay",
  () => {
    test.each(["en", "zh"])(
      "%s: every section resolves its copy",
      async (locale) => {
        const base = (await import(`../../../messages/${locale}.json`)).default;
        const { textContent } = render(
          <NextIntlClientProvider
            locale={locale}
            messages={withOverlayMessages(locale, base)}
          >
            <Landing config={withOverlay(siteConfig)} />
          </NextIntlClientProvider>,
        ).container;
        expect(textContent).not.toMatch(/Landing\.[A-Za-z]/);
      },
    );
  },
);
