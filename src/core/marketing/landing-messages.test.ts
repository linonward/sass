import { describe, expect, test } from "vitest";

import messages from "../../../messages/en.json";
import siteConfig from "../../../site.config";

const { landing, billing } = siteConfig;
const t = messages.Landing;

// 配置里引用的文案 key 在类型上是任意字符串，这里保证它们都存在于 en.json。
describe("落地页配置引用的文案 key 都在 en.json 中", () => {
  test("features", () => {
    expect(Object.keys(t.features.items)).toEqual(
      expect.arrayContaining(landing.features.map((f) => f.key)),
    );
  });

  test("faq", () => {
    expect(Object.keys(t.faq.items)).toEqual(
      expect.arrayContaining(landing.faq),
    );
  });

  test("pricing plans 与 plan features", () => {
    expect(Object.keys(t.pricing.plans)).toEqual(
      expect.arrayContaining(billing.plans.map((p) => p.id)),
    );
    expect(Object.keys(t.pricing.features)).toEqual(
      expect.arrayContaining(billing.plans.flatMap((p) => p.features)),
    );
  });
});

// Dynamic buyer-configured keys cross a type assertion at the rendering boundary.
// Check actual locale dictionaries, including image alt text, rather than sample key names.
describe("testimonial translations", () => {
  test.each(["en", "zh"])("configured items exist in %s", async (locale) => {
    const { default: messages } = await import(
      `../../../messages/${locale}.json`
    );
    for (const item of landing.testimonials.items) {
      const copy = messages.Landing.testimonials.items[item.key];
      expect(copy?.quote).toEqual(expect.any(String));
      expect(copy?.role).toEqual(expect.any(String));
      if (item.type === "image")
        expect(copy?.imageAlt).toEqual(expect.any(String));
    }
  });
});
