import { defineConfig } from "./src/core/config/schema";

export default defineConfig({
  name: "Acme",
  domain: "sass.linonward.com",
  description: "Ship your SaaS in a day.",
  brand: {
    primaryColor: "#4f46e5",
    logo: "/logo.svg",
  },
  locales: ["en"],
  defaultLocale: "en",
  features: {
    credits: false,
    ai: false,
    blog: false,
    upload: false,
    admin: false,
    rateLimit: false,
  },
  nav: {
    header: [
      { key: "features", href: "/#features" },
      { key: "pricing", href: "/#pricing" },
      { key: "faq", href: "/#faq" },
    ],
    footer: [
      {
        key: "product",
        links: [
          { key: "features", href: "/#features" },
          { key: "pricing", href: "/#pricing" },
          { key: "faq", href: "/#faq" },
        ],
      },
      {
        key: "legal",
        links: [
          { key: "privacy", href: "/privacy" },
          { key: "terms", href: "/terms" },
          { key: "refund", href: "/refund" },
        ],
      },
    ],
  },
  // 法律页（content/legal/）里引用的主体信息，上线前改成你自己的。
  legal: {
    companyName: "Acme Inc.",
    contactEmail: "support@example.com",
    jurisdiction: "the State of Delaware, United States",
    effectiveDate: "2026-01-01",
  },
  landing: {
    sections: ["hero", "features", "pricing", "faq", "cta"],
    hero: {
      image: {
        src: "/landing/hero.svg",
        darkSrc: "/landing/hero-dark.svg",
        width: 1200,
        height: 720,
      },
    },
    features: [
      { key: "auth", icon: "shield" },
      { key: "billing", icon: "creditCard" },
      { key: "i18n", icon: "globe" },
      { key: "ai", icon: "sparkles" },
      { key: "seo", icon: "chart" },
      { key: "fast", icon: "zap" },
    ],
    faq: ["stack", "payments", "customize", "license"],
  },
  billing: {
    currency: "USD",
    plans: [
      {
        id: "free",
        price: 0,
        interval: "month",
        features: ["credits100", "coreFeatures", "communitySupport"],
      },
      {
        id: "pro",
        price: 19,
        interval: "month",
        features: ["credits2000", "coreFeatures", "prioritySupport"],
        highlighted: true,
      },
      {
        id: "lifetime",
        price: 199,
        interval: "once",
        features: ["credits2000", "coreFeatures", "lifetimeUpdates"],
      },
    ],
  },
  // 事务邮件（登录验证码、欢迎邮件等）的发件信息。发件域名需在 Resend 验证。
  email: {
    fromName: "Acme",
    fromAddress: "noreply@sass.linonward.com",
    replyTo: "support@example.com",
  },
});
