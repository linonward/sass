import { describe, expect, test } from "vitest";

import { defineConfig, type SiteConfigInput } from "./schema";

const valid: SiteConfigInput = {
  name: "Acme",
  domain: "example.com",
  description: "Ship your SaaS in a day.",
  brand: { primaryColor: "#4f46e5", logo: "/logo.svg" },
  locales: ["en", "zh-CN"],
  defaultLocale: "en",
  features: { ai: true },
};

describe("defineConfig", () => {
  test("合法配置通过校验，未填写的 feature 默认关闭", () => {
    const config = defineConfig(valid);
    expect(config.features).toEqual({
      credits: false,
      ai: true,
      blog: false,
      upload: false,
      admin: false,
      rateLimit: false,
    });
  });

  test("省略 features 时全部关闭", () => {
    const config = defineConfig({ ...valid, features: undefined });
    expect(Object.values(config.features)).not.toContain(true);
  });

  test.each([
    ["domain", { domain: "https://example.com" }],
    ["brand.primaryColor", { brand: { primaryColor: "red", logo: "/l.svg" } }],
    ["brand.logo", { brand: { primaryColor: "#fff", logo: "logo.svg" } }],
    ["name", { name: "  " }],
    ["locales", { locales: [] }],
    ["locales", { locales: ["en", "en"] }],
    ["locales.1", { locales: ["en", "English"] }],
    ["defaultLocale", { defaultLocale: "fr" }],
    ["features.ai", { features: { ai: "yes" } }],
  ])("非法字段 %s 出现在报错中", (path, patch) => {
    expect(() =>
      defineConfig({ ...valid, ...patch } as SiteConfigInput),
    ).toThrow(`- ${path}: `);
  });

  test("拼错的字段名会被指出", () => {
    expect(() =>
      defineConfig({
        ...valid,
        features: { ai: true, ratelimit: true },
      } as SiteConfigInput),
    ).toThrow(/features: .*ratelimit/);
  });
});

describe("nav", () => {
  test("省略 nav 时 header 与 footer 为空", () => {
    expect(defineConfig(valid).nav).toEqual({ header: [], footer: [] });
  });

  test.each([
    ["nav.header.0.href", { header: [{ key: "a", href: "http://x.com" }] }],
    ["nav.header.0.key", { header: [{ key: "Get started", href: "/a" }] }],
    ["nav.footer.0.links", { footer: [{ key: "product", links: [] }] }],
  ])("非法字段 %s 出现在报错中", (path, nav) => {
    expect(() => defineConfig({ ...valid, nav } as SiteConfigInput)).toThrow(
      `- ${path}: `,
    );
  });
});
