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
    // 演示站点开启积分，付费套餐按 billing.plans 的 credits 发放。
    credits: true,
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
        credits: 100,
      },
      {
        id: "pro",
        price: 19,
        interval: "month",
        features: ["credits2000", "coreFeatures", "prioritySupport"],
        highlighted: true,
        // Creem 的产品 ID。占位值（prod_placeholder_*）不允许结账。
        // 测试模式和生产模式的产品 ID 不同，切换 CREEM_MODE 时一起换（见 README 上线清单）。
        // 当前是 Creem 测试模式的产品。
        providerProductId: "prod_31E1j5WjJjaC4L3nSGOPSm",
        credits: 2000,
      },
      {
        id: "lifetime",
        price: 199,
        interval: "once",
        features: ["credits2000", "coreFeatures", "lifetimeUpdates"],
        // 同上：Creem 测试模式的一次性付款产品。
        providerProductId: "prod_5uhJLXA1d1LwEmPjIUXyU9",
        credits: 2000,
      },
    ],
  },
  // 事务邮件（登录验证码、欢迎邮件等）的发件信息。发件域名需在 Resend 验证。
  email: {
    fromName: "Acme",
    fromAddress: "noreply@sass.linonward.com",
    replyTo: "support@example.com",
  },
  // 邮箱验证码登录的参数（见 docs/plan.md 关键决策 7）。
  auth: {
    emailOtp: {
      length: 6,
      expiresIn: 300,
      allowedAttempts: 3,
      resendCooldown: 60,
    },
  },
  // 登录后侧边栏里业务自己的菜单项，文案在 messages 的 Dashboard.nav.<key>。
  // 例如 { key: "projects", href: "/projects", icon: "layers" }；新增的一级路由还要登记到 src/core/auth/routes.ts。
  dashboard: {
    nav: [],
  },
  credits: {
    // 余额跌破这个值时提醒用户充值（credits-low 邮件）。
    lowBalanceThreshold: 100,
  },
  // 接口限流（AI、上传），计数存 Upstash Redis。每条策略同时按用户和按 IP 计数。
  rateLimit: {
    // Redis 出错时：open 放行（积分扣减兜底），closed 返回 503。
    failMode: "open",
    policies: {
      ai: { limit: 20, window: "1 m" },
      upload: { limit: 10, window: "1 m" },
    },
  },
  // 文件上传（Cloudflare R2）。只在 features.upload 开启时生效；SVG、HTML 不在可选类型里。
  upload: {
    allowedMimeTypes: [
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/pdf",
    ],
    // 单个文件的大小上限（字节）。
    maxFileSize: 10 * 1024 * 1024,
    // false：私有文件，只能通过有时效的签名地址访问；true：通过 R2_PUBLIC_URL 公开访问。
    public: false,
  },
});
