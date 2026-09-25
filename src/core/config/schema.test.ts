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
  legal: {
    companyName: "Acme Inc.",
    contactEmail: "support@example.com",
    jurisdiction: "the State of Delaware, United States",
    effectiveDate: "2026-01-31",
  },
  email: {
    fromName: "Acme",
    fromAddress: "noreply@example.com",
    replyTo: "support@example.com",
  },
  auth: {
    emailOtp: {
      length: 6,
      expiresIn: 300,
      allowedAttempts: 3,
      resendCooldown: 60,
    },
  },
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

describe("legal", () => {
  test("合法的 legal 原样保留", () => {
    expect(defineConfig(valid).legal.companyName).toBe("Acme Inc.");
  });

  test("缺少 legal 时报错", () => {
    expect(() =>
      defineConfig({
        ...valid,
        legal: undefined,
      } as unknown as SiteConfigInput),
    ).toThrow("- legal: ");
  });

  test.each([
    ["legal.companyName", { companyName: " " }],
    ["legal.contactEmail", { contactEmail: "support" }],
    ["legal.jurisdiction", { jurisdiction: "" }],
    ["legal.effectiveDate", { effectiveDate: "31/01/2026" }],
    ["legal.effectiveDate", { effectiveDate: "2026-02-30" }],
  ])("非法字段 %s 出现在报错中", (path, patch) => {
    expect(() =>
      defineConfig({ ...valid, legal: { ...valid.legal!, ...patch } }),
    ).toThrow(`- ${path}: `);
  });
});

describe("email", () => {
  test("合法的 email 原样保留，logo 可省略", () => {
    expect(defineConfig(valid).email).toEqual({
      fromName: "Acme",
      fromAddress: "noreply@example.com",
      replyTo: "support@example.com",
    });
  });

  test("缺少 email 时报错", () => {
    const { email: _email, ...rest } = valid;
    void _email;
    expect(() => defineConfig(rest as SiteConfigInput)).toThrow("- email: ");
  });

  test.each([
    ["email.fromAddress", { fromName: "A", fromAddress: "not-an-email" }],
    ["email.replyTo", { fromName: "A", fromAddress: "a@b.co", replyTo: "x" }],
    ["email.fromName", { fromName: " ", fromAddress: "a@b.co" }],
    ["email.logo", { fromName: "A", fromAddress: "a@b.co", logo: "/logo.svg" }],
  ])("非法字段 %s 出现在报错中", (path, email) => {
    expect(() => defineConfig({ ...valid, email } as SiteConfigInput)).toThrow(
      `- ${path}: `,
    );
  });
});

describe("auth", () => {
  test.each([
    ["auth.emailOtp.length", { length: 3 }],
    ["auth.emailOtp.expiresIn", { expiresIn: 0 }],
    ["auth.emailOtp.allowedAttempts", { allowedAttempts: 1.5 }],
    ["auth.emailOtp.resendCooldown", { resendCooldown: -1 }],
  ])("非法字段 %s 出现在报错中", (path, patch) => {
    expect(() =>
      defineConfig({
        ...valid,
        auth: { emailOtp: { ...valid.auth.emailOtp, ...patch } },
      }),
    ).toThrow(`- ${path}: `);
  });

  test("缺少 auth 时报错", () => {
    const rest: Partial<SiteConfigInput> = { ...valid };
    delete rest.auth;
    expect(() => defineConfig(rest as SiteConfigInput)).toThrow("- auth: ");
  });
});
