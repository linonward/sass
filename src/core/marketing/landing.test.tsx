import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test } from "vitest";

import { defineConfig, type SiteConfigInput } from "@/core/config/schema";

import messages from "../../../messages/en.json";
import siteConfig from "../../../site.config";
import { Landing } from "./landing";

function renderSections(sections: string[]) {
  const config = defineConfig({
    ...siteConfig,
    landing: { ...siteConfig.landing, sections },
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
  test("按配置顺序渲染全部区块", () => {
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

  test("调整顺序后渲染顺序随之变化", () => {
    expect(sectionIds(renderSections(["faq", "hero", "cta"]))).toEqual([
      "faq",
      "hero",
      "cta",
    ]);
  });

  test("删除的区块不再渲染", () => {
    const rendered = sectionIds(
      renderSections(["hero", "features", "faq", "cta"]),
    );
    expect(rendered).not.toContain("pricing");
  });

  test("空数组时不渲染任何区块", () => {
    expect(sectionIds(renderSections([]))).toEqual([]);
  });

  // next-intl 遇到缺失的 key 或解析不了的 ICU 消息时，会把 key 原样渲染到页面上。
  // 这种错误只有跑一遍真实渲染才看得见：`{ model, credits }` 这种带花括号的文案
  // 会被当成 ICU 占位符解析失败，就是这条兜住的。
  test("文案全部解析成功，没有原样漏出来的 key", () => {
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

describe("交付区块的购买卡片", () => {
  function renderDelivery(plans?: (plans: PlansInput) => PlansInput) {
    const input = siteConfig as SiteConfigInput;
    const config = defineConfig({
      ...input,
      billing: {
        ...input.billing,
        plans: plans ? plans(input.billing?.plans ?? []) : input.billing?.plans,
      },
      landing: { ...input.landing, sections: ["delivery"] },
    } as SiteConfigInput);
    return render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Landing config={config} />
      </NextIntlClientProvider>,
    );
  }

  test("显示 purchasePlan 套餐的价格、条款和购买按钮", () => {
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
  });

  test("套餐被隐藏或不存在时退回「即将公布」，没有购买按钮", () => {
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

describe("landing / billing 配置", () => {
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
  ])("非法字段 %s 出现在报错中", (path, patch) => {
    expect(() =>
      defineConfig({ ...siteConfig, ...patch } as SiteConfigInput),
    ).toThrow(`- ${path}: `);
  });
});

describe("首屏与结尾的按钮", () => {
  function renderWith({
    hidden = false,
    showcaseUrl,
  }: { hidden?: boolean; showcaseUrl?: string } = {}) {
    const input = siteConfig as SiteConfigInput;
    const config = defineConfig({
      ...input,
      billing: {
        ...input.billing,
        plans: input.billing?.plans?.map((p) =>
          p.id === "lifetime" ? { ...p, price: 99, hidden } : p,
        ),
      },
      landing: { ...input.landing, sections: ["hero", "cta"], showcaseUrl },
    } as SiteConfigInput);
    return render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Landing config={config} />
      </NextIntlClientProvider>,
    );
  }
  const t = messages.Landing;

  test("有可买的套餐：主按钮是「立即购买 · 价格」，跳到交付区块的购买卡片", () => {
    const view = renderWith();
    const buy = view.getAllByRole("link", { name: "Buy now · $99" });
    expect(buy).toHaveLength(2);
    for (const link of buy) {
      expect(link.getAttribute("href")).toMatch(/#delivery$/);
    }
    expect(view.getByText(t.hero.offerNote)).toBeDefined();
    // 没配真实案例时，次按钮是站内演示。
    for (const link of view.getAllByRole("link", {
      name: t.hero.primaryCta,
    })) {
      expect(link.getAttribute("href")).toMatch(/\/demo$/);
    }
  });

  test("配了 showcaseUrl：次按钮在新标签页打开真实案例", () => {
    const view = renderWith({ showcaseUrl: "https://shots.example.com" });
    for (const link of view.getAllByRole("link", {
      name: t.hero.showcaseCta,
    })) {
      expect(link.getAttribute("href")).toBe("https://shots.example.com");
      expect(link.getAttribute("target")).toBe("_blank");
    }
    expect(view.queryByRole("link", { name: t.hero.primaryCta })).toBeNull();
  });

  test("套餐被隐藏：退回演示为主按钮，不显示价格说明", () => {
    const view = renderWith({ hidden: true });
    expect(view.queryByRole("link", { name: /Buy now/ })).toBeNull();
    expect(view.queryByText(t.hero.offerNote)).toBeNull();
    for (const link of view.getAllByRole("link", {
      name: t.hero.primaryCta,
    })) {
      expect(link.getAttribute("href")).toMatch(/\/demo$/);
    }
  });

  test("showcaseUrl 只接受 https", () => {
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

describe("省掉的工时", () => {
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

  test("逐项列出工时，合计自动算", () => {
    const view = renderTimeSaved(siteConfig.landing.timeSaved);
    const items = view.container.querySelectorAll("#timesaved li");
    expect(items).toHaveLength(siteConfig.landing.timeSaved.length);
    const total = siteConfig.landing.timeSaved.reduce((n, i) => n + i.hours, 0);
    expect(view.getByTestId("timesaved-total").textContent).toContain(
      `${total} hours`,
    );
  });

  test("空列表时整个区块不渲染", () => {
    const view = renderTimeSaved([]);
    expect(sectionIds(view.container)).toEqual(["hero", "features"]);
  });

  test("配置里的每个 key 在中英文案里都有", async () => {
    const zh = (await import("../../../messages/zh.json")).default;
    for (const { key } of siteConfig.landing.timeSaved) {
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
