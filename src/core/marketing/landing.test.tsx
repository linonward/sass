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
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Landing config={config} />
    </NextIntlClientProvider>,
  );
  return [...container.querySelectorAll("[data-section]")].map((el) =>
    el.getAttribute("data-section"),
  );
}

describe("Landing", () => {
  test("按配置顺序渲染全部区块", () => {
    expect(
      renderSections(["hero", "features", "pricing", "faq", "cta"]),
    ).toEqual(["hero", "features", "pricing", "faq", "cta"]);
  });

  test("调整顺序后渲染顺序随之变化", () => {
    expect(renderSections(["faq", "hero", "cta"])).toEqual([
      "faq",
      "hero",
      "cta",
    ]);
  });

  test("删除的区块不再渲染", () => {
    const rendered = renderSections(["hero", "features", "faq", "cta"]);
    expect(rendered).not.toContain("pricing");
  });

  test("空数组时不渲染任何区块", () => {
    expect(renderSections([])).toEqual([]);
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
