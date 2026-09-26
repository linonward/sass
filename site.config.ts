import { defineConfig } from "./src/core/config/schema";
import { defaultLocale, locales } from "./src/core/i18n/locales";

/**
 * 站点配置。买家直接改这个文件里的字面量。
 *
 * 有四个字段可以额外用环境变量覆盖，写法都是「envOverride(变量名) ?? 占位字面量」：
 * `domain`（`SITE_DOMAIN`）、`email.fromAddress`（`SITE_EMAIL_FROM`）、
 * 两个套餐的 `providerProductId`（`CREEM_PRODUCT_ID_PRO` / `CREEM_PRODUCT_ID_LIFETIME`）。
 * 模板里只留占位值，真实域名和产品 ID 放在部署环境里；不设这些变量时就是占位配置。
 * 没有对应变量的字段（名称、颜色、文案）只能改这个文件。
 */
const envOverride = (name: string): string | undefined => {
  // 空值按「没设置」处理，和 src/core/create-env.ts 的 emptyStringAsUndefined 一致：
  // .env.example 里这几个变量出厂是留空的，复制成 .env.local 后不该把配置顶成空串。
  const value = process.env[name]?.trim();
  return value === "" ? undefined : value;
};

export default defineConfig({
  name: "Acme",
  // 占位域名，改成自己的（不带协议）。演示站用 SITE_DOMAIN 覆盖。
  domain: envOverride("SITE_DOMAIN") ?? "example.com",
  description: "Ship your SaaS in a day.",
  brand: {
    primaryColor: "#4f46e5",
    logo: "/logo.svg",
  },
  // 语言清单的**值**在 src/core/i18n/locales.ts（那边不经过 zod，见该文件注释）；
  // 这里引进来交给 schema 校验，所以它仍然是唯一来源。改语言改那个文件。
  locales,
  defaultLocale,
  features: {
    // 演示站点开启积分、AI、博客、文件上传和后台；积分按 billing.plans 的 credits 发放。
    // 后台 /admin：用 ADMIN_EMAILS 里的邮箱登录即成为管理员。
    // 博客文章放在 content/blog/<locale>/<slug>.mdx，字段见 content-collections.ts。
    credits: true,
    ai: true,
    blog: true,
    upload: true,
    admin: true,
    // 策略见下面的 rateLimit；Redis 没配时放行（failMode open 兜底）。
    rateLimit: true,
    // 结构化日志、追踪和分析，细项见下面的 observability。
    observability: true,
  },
  nav: {
    header: [
      { key: "features", href: "/#features" },
      { key: "pricing", href: "/#pricing" },
      { key: "faq", href: "/#faq" },
      // 关闭 features.blog 时把 Blog 链接一起删掉。
      { key: "blog", href: "/blog" },
    ],
    footer: [
      {
        key: "product",
        links: [
          { key: "features", href: "/#features" },
          { key: "pricing", href: "/#pricing" },
          { key: "faq", href: "/#faq" },
          { key: "blog", href: "/blog" },
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
    // hero 不配 image 时，首屏右侧渲染用真实 DOM 拼出来的产品 mock
    // （终端 + 结账台 + 到账提示，报价取自下面 billing.plans 的高亮套餐）。
    // 想换回静态图片就在 hero 下加 image: { src, darkSrc?, width, height }，
    // 图片路径放 public/ 下，alt 文案在 messages 的 Landing.hero.imageAlt。
    hero: {},
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
        // Creem 的产品 ID。占位值（prod_placeholder_*）不允许结账（见 src/core/billing/checkout.ts）；
        // 换成自己的产品 ID，或用 CREEM_PRODUCT_ID_PRO 覆盖。
        // 测试模式和生产模式的产品 ID 不同，切换 CREEM_MODE 时一起换（见 README 上线清单）。
        providerProductId:
          envOverride("CREEM_PRODUCT_ID_PRO") ?? "prod_placeholder_pro",
        credits: 2000,
      },
      {
        id: "lifetime",
        price: 199,
        interval: "once",
        features: ["credits2000", "coreFeatures", "lifetimeUpdates"],
        // 同上：一次性的产品，用 CREEM_PRODUCT_ID_LIFETIME 覆盖。
        providerProductId:
          envOverride("CREEM_PRODUCT_ID_LIFETIME") ??
          "prod_placeholder_lifetime",
        credits: 2000,
      },
    ],
  },
  // 事务邮件（登录验证码、欢迎邮件等）的发件信息。发件域名需在 Resend 验证。
  email: {
    fromName: "Acme",
    // 改成自己在 Resend 验证过的发件地址；演示站用 SITE_EMAIL_FROM 覆盖。
    fromAddress: envOverride("SITE_EMAIL_FROM") ?? "noreply@example.com",
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
  // 例如 { key: "projects", href: "/projects", icon: "layers" }；这些路径自动需要登录。
  // 不在侧边栏里的业务页面（放在 (app) 下）也会由 layout 校验登录，只是跳转登录页时不带回跳地址。
  dashboard: {
    // 示例业务模块（src/features/example/）。删除示例时把这一项一起删掉。
    nav: [{ key: "example", href: "/example", icon: "sparkles" }],
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
    // 设为 true 时 R2_PUBLIC_URL 要填 bucket 的公开域名（例如 https://files.example.com）。
    public: true,
  },
  // 可观测性（features.observability 开启时生效）。开启后生产环境日志是单行 JSON，带 traceId。
  observability: {
    logLevel: "info",
    // OpenTelemetry 追踪：Vercel 上开启 Tracing 或 OTel 集成，其他环境填 OTEL_EXPORTER_OTLP_ENDPOINT。
    otel: false,
    // Sentry 错误上报：开启后填 NEXT_PUBLIC_SENTRY_DSN；再填 SENTRY_AUTH_TOKEN / SENTRY_ORG /
    // SENTRY_PROJECT 会在构建时上传 source map。只发用户 ID，不发邮箱和 IP。
    sentry: false,
    // Vercel Analytics（页面浏览和转化事件）与 Speed Insights，都要先在 Vercel 项目里开启。
    // 自定义事件（sign_up、checkout_started、purchase）需要 Pro 计划，Hobby 只有页面浏览。
    analytics: true,
    speedInsights: true,
  },
  // AI 模型（features.ai 开启时生效）。每次调用按 creditCost 预扣积分，失败退回。
  // env 里只配了某几家的 key 时，其他服务商的模型调用返回 503；生产环境会要求这里用到的每家 key。
  ai: {
    // 演示站点只用阿里云百炼（ALIBABA_API_KEY）；换成 OpenAI、Anthropic、Google 时改 provider 和 model。
    // 百炼上的这些模型默认开思考，按次计费的轻量模型用 reasoning: "none" 关掉。
    models: [
      {
        id: "deepseek",
        provider: "alibaba",
        model: "deepseek-v4-flash",
        creditCost: 1,
        maxOutputTokens: 2048,
        reasoning: "none",
      },
      {
        id: "qwen-flash",
        provider: "alibaba",
        model: "qwen3.8-flash",
        creditCost: 1,
        maxOutputTokens: 2048,
        reasoning: "none",
      },
      {
        id: "qwen-max",
        provider: "alibaba",
        model: "qwen3.8-max",
        creditCost: 5,
        maxOutputTokens: 4096,
      },
    ],
    defaultModel: "deepseek",
    // 图片模型（还需要 features.upload：结果存进 R2）。creditCost 按服务商的单张价格定。
    imageModels: [
      {
        id: "qwen-image",
        provider: "alibaba",
        model: "qwen-image-3.0",
        creditCost: 5,
      },
      {
        id: "wan-image",
        provider: "alibaba",
        model: "wan2.7-image-pro",
        creditCost: 10,
      },
    ],
    defaultImageModel: "qwen-image",
    // 视频模型（同样需要 features.upload）。异步生成，时长和分辨率固定，按次扣费。
    videoModels: [
      {
        id: "wan-t2v",
        provider: "alibaba",
        model: "wan2.7-t2v",
        input: "text",
        creditCost: 30,
        duration: 5,
        resolution: "720P",
      },
      {
        id: "wan-i2v",
        provider: "alibaba",
        model: "wan2.7-i2v",
        input: "image",
        creditCost: 30,
        duration: 5,
        resolution: "720P",
      },
    ],
    defaultVideoModel: "wan-t2v",
  },
});
