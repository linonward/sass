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
