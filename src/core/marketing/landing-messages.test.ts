import { describe, expect, test } from "vitest";

import messages from "../../../messages/en.json";
import siteConfig from "../../../site.config";

const { landing, billing } = siteConfig;
const t = messages.Landing;

// Message keys referenced in config are typed as arbitrary strings; this ensures they all exist in
// en.json.
describe("message keys referenced by the landing config are all in en.json", () => {
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

  test("pricing plans and plan features", () => {
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
