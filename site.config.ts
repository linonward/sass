import {
  placeholderAction,
  placeholderIssues,
} from "./src/core/config/sentinels";
import { defineConfig } from "./src/core/config/schema";
import {
  billingProviderNames,
  type BillingProviderName,
} from "./src/core/billing/env";
import { defaultLocale, locales } from "./src/core/i18n/locales";

/**
 * 站点配置。买家直接改这个文件里的字面量。
 *
 * 有六个字段可以额外用环境变量覆盖，写法都是「envOverride(变量名) ?? 占位字面量」：
 * `name`（`SITE_NAME`）、`domain`（`SITE_DOMAIN`）、`email.fromAddress`（`SITE_EMAIL_FROM`）、
 * `legal.companyName`（`SITE_LEGAL_NAME`）、两个套餐的 `providerProductId`
 * （变量名随生效的服务商走，见下面的 effectiveBillingProvider：creem 是
 * `CREEM_PRODUCT_ID_PRO` / `CREEM_PRODUCT_ID_LIFETIME`，stripe 是
 * `STRIPE_PRICE_ID_PRO` / `STRIPE_PRICE_ID_LIFETIME`，lemonsqueezy 是
 * `LEMONSQUEEZY_VARIANT_ID_PRO` / `LEMONSQUEEZY_VARIANT_ID_LIFETIME`）。
 * 模板里只留占位值，真实域名、名称和产品 ID 放在部署环境里；不设这些变量时就是占位配置。
 * 没有对应变量的字段（颜色、文案）只能改这个文件。
 */
const envOverride = (name: string): string | undefined => {
  // 空值按「没设置」处理，和 src/core/create-env.ts 的 emptyStringAsUndefined 一致：
  // .env.example 里这几个变量出厂是留空的，复制成 .env.local 后不该把配置顶成空串。
  const value = process.env[name]?.trim();
  return value === "" ? undefined : value;
};

/**
 * 用来收款的支付服务商。只能改这里的字面量（要改的是类型校验时的默认值）；
 * 运行时可以用 `BILLING_PROVIDER` 覆盖它，环境变量优先。
 */
const billingProvider: BillingProviderName = "creem";

/**
 * 生效的服务商：这里的 provider 可以被运行时的 `BILLING_PROVIDER` 覆盖，
 * 判断和 src/core/billing/env.ts 一致（fake 不是真实服务商，不参与；
 * 只有 creem / stripe / lemonsqueezy 会覆盖）。
 */
const effectiveBillingProvider: BillingProviderName =
  billingProviderNames.find((name) => name === process.env.BILLING_PROVIDER) ??
  billingProvider;

/**
 * 套餐产品 ID 的环境变量前缀，随生效的服务商走：换服务商时产品 ID 的变量名一起换，
 * 不用同时记住两套。creem 的 prod_*、stripe 的 price_* 和 Lemon Squeezy 的变体（variant）
 * 在各自后台里是不同的对象 —— LS 下 `providerProductId` 填的就是**变体** ID。
 */
const productIdEnvPrefix: Record<BillingProviderName, string> = {
  creem: "CREEM_PRODUCT_ID",
  stripe: "STRIPE_PRICE_ID",
  lemonsqueezy: "LEMONSQUEEZY_VARIANT_ID",
  // Waffo Pancake 的产品 ID（`PROD_…`），test / prod 两套。
  waffo: "WAFFO_PRODUCT_ID",
};

/**
 * 没配环境变量时的产品 ID 占位值。它是**与服务商无关的哨兵值**：`prod_placeholder_` 前缀会被
 * src/core/billing/checkout.ts 拦下，结账直接报错，不会拿假 ID 去调服务商。
 */
const placeholderProductId = (plan: string) => `prod_placeholder_${plan}`;

const config = defineConfig({
  name: envOverride("SITE_NAME") ?? "Acme",
  // 占位域名，改成自己的（不带协议）。演示站用 SITE_DOMAIN 覆盖。
  domain: envOverride("SITE_DOMAIN") ?? "example.com",
  description: "The starter kit for your AI business.",
  brand: {
    primaryColor: "#0f766e",
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
    // 策略见下面的 rateLimit。Redis 没配时：本地、CI 和 Vercel 预览放行（failMode open 兜底），
    // 自托管生产（NODE_ENV=production 且不在 Vercel 上）拒绝请求并打 error 日志，
    // 免得静默变成不限流；确实不要限流就设 ALLOW_UNRATELIMITED=1。
    rateLimit: true,
    // 结构化日志、追踪和分析，细项见下面的 observability。
    observability: true,
    // 示例业务模块：发票 CRUD（src/features/invoices/）。关掉后 /invoices 404、
    // 侧边栏也没有入口；删除整个示例的清单见 src/features/invoices/schema.ts 末尾。
    examples: { invoices: true },
  },
  nav: {
    header: [
      { key: "features", href: "/#features" },
      { key: "delivery", href: "/#delivery" },
      { key: "faq", href: "/#faq" },
      // 关闭 features.blog 时把 Blog 链接一起删掉。
      { key: "blog", href: "/blog" },
    ],
    footer: [
      {
        key: "product",
        links: [
          { key: "features", href: "/#features" },
          { key: "pricing", href: "/pricing" },
          { key: "faq", href: "/#faq" },
          { key: "blog", href: "/blog" },
          // 关掉 changelog.enabled 时这一项会自动隐藏（见 src/core/layout/footer-nav.ts），
          // 不用手删。
          { key: "changelog", href: "/changelog" },
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
    companyName: envOverride("SITE_LEGAL_NAME") ?? "Acme Inc.",
    contactEmail: "support@example.com",
    jurisdiction: "the State of Delaware, United States",
    effectiveDate: "2026-01-01",
  },
  landing: {
    sections: ["hero", "features", "testimonials", "delivery", "faq", "cta"],
    // hero 不配 image 时，首屏右侧渲染用真实 DOM 拼出来的产品 mock
    // （AI 工作室 + 积分流水，明确标记为示例数据，不触发模型调用）。
    // 想换回静态图片就在 hero 下加 image: { src, darkSrc?, width, height }，
    // 图片路径放 public/ 下，alt 文案在 messages 的 Landing.hero.imageAlt。
    hero: {},
    features: [
      { key: "billing", icon: "creditCard", preview: "billing" },
      { key: "ai", icon: "sparkles", preview: "ai" },
      { key: "operations", icon: "chart", preview: "usage" },
    ],
    // 示例评价不是客户背书。换成已获授权的真实评价后，逐项移除 example。
    // 改排序/关区块用 sections；清空 items 也会隐藏，不留下空白色带。
    // 正文、身份和图片 alt 在 messages 的 Landing.testimonials.items.<key>。
    // image/video 素材与头像放 public/；video 必须提供 poster、尺寸和字幕。
    testimonials: {
      items: [
        {
          key: "focus",
          type: "quote",
          example: true,
          author: { name: "Maker A" },
        },
        {
          key: "validate",
          type: "image",
          example: true,
          author: { name: "Maker B" },
          media: { src: "/landing/perfume.webp", width: 1536, height: 1024 },
        },
        {
          key: "flow",
          type: "quote",
          example: true,
          author: { name: "Maker C" },
        },
        {
          key: "brand",
          type: "quote",
          example: true,
          author: { name: "Maker D" },
        },
        {
          key: "operate",
          type: "image",
          example: true,
          author: { name: "Maker E" },
          media: { src: "/landing/skincare.webp", width: 1122, height: 1402 },
        },
        {
          key: "build",
          type: "quote",
          example: true,
          author: { name: "Maker F" },
        },
      ],
    },
    faq: ["fit", "services", "payments", "customize"],
  },
  billing: {
    // 支付服务商。改这里之前先看 README 的「上线清单 → 支付」：各家需要的环境变量不同。
    provider: billingProvider,
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
        // 服务商那边的产品 ID（见上面的 productIdEnvPrefix；Lemon Squeezy 下是变体 ID）。
        // 占位值不允许结账（见 src/core/billing/checkout.ts）；换成自己的产品 ID，
        // 或用上面 billingProvider 对应的变量覆盖。测试模式和生产模式的产品 ID 不同，
        // 切换模式时一起换（见 README 上线清单）。
        providerProductId:
          envOverride(`${productIdEnvPrefix[effectiveBillingProvider]}_PRO`) ??
          placeholderProductId("pro"),
        credits: 2000,
      },
      {
        id: "lifetime",
        price: 199,
        interval: "once",
        features: ["credits2000", "coreFeatures", "lifetimeUpdates"],
        // 同上：一次性的产品，用 `..._LIFETIME` 覆盖。
        providerProductId:
          envOverride(
            `${productIdEnvPrefix[effectiveBillingProvider]}_LIFETIME`,
          ) ?? placeholderProductId("lifetime"),
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
  // 邮箱验证码登录的参数（显式配置，不依赖插件默认值）。
  auth: {
    emailOtp: {
      length: 6,
      expiresIn: 300,
      allowedAttempts: 3,
      resendCooldown: 60,
    },
    // 改邮箱（`/email-otp/change-email` 等接口；设置页暂时没有入口）。verifyCurrentEmail
    // 会往当前邮箱也发一个验证码，只有两个验证码都拿到才能改 —— 只偷到 session cookie
    // 的人改不了邮箱，否则等于把账号交出去。改成功后该用户所有 session 立即失效
    // （见 src/core/auth/session-invalidation.ts）。
    changeEmail: {
      enabled: true,
      verifyCurrentEmail: true,
    },
  },
  // 登录后侧边栏里业务自己的菜单项，文案在 messages 的 Dashboard.nav.<key>。
  // 例如 { key: "projects", href: "/projects", icon: "layers" }；这些路径自动需要登录。
  // 不在侧边栏里的业务页面（放在 (app) 下）也会由 layout 校验登录，只是跳转登录页时不带回跳地址。
  dashboard: {
    nav: [
      // 首次运行清单（src/core/onboarding/）：注册后自动落一次，之后从这里随时进。
      // 是套件页，但入口和其它业务菜单排在一起，侧边栏的顺序就只有一个来源。
      { key: "onboarding", href: "/onboarding", icon: "fileText" },
      // 示例业务模块（src/features/example/）。删除示例时把这一项一起删掉。
      { key: "example", href: "/example", icon: "sparkles" },
    ],
  },
  credits: {
    // 余额跌破这个值时提醒用户充值（credits-low 邮件）。
    lowBalanceThreshold: 100,
  },
  // 更新日志。条目放在 content/changelog/<slug>.mdx，字段见 content-collections.ts。
  // 关闭时 /changelog 和 /changelog/rss.xml 返回 404，页脚也不显示入口。
  changelog: {
    enabled: true,
  },
  // 接口限流（AI、上传、结账），计数存 Upstash Redis。每条策略同时按用户和按 IP 计数。
  rateLimit: {
    // Redis 出错时：open 放行（积分扣减兜底），closed 返回 503。
    // 这里是「Redis 在但请求失败」的行为；Redis 根本没配时见 features.rateLimit 的说明。
    failMode: "open",
    policies: {
      ai: { limit: 20, window: "1 m" },
      upload: { limit: 10, window: "1 m" },
      // 结账会话：每次调用都会在服务商侧真实建单，防脚本循环创建（双击由幂等/互斥处理）。
      checkout: { limit: 5, window: "1 m" },
      // 状态页的邮件订阅：每次提交都可能发一封确认信，按 IP 计数即可。
      statusSubscribe: { limit: 5, window: "1 h" },
      // 邀请链接的接受接口（未登录可访问）：每次只做一次按码的查询，按 IP 计数即可。
      referralAccept: { limit: 30, window: "1 h" },
    },
  },
  // 用户 API Key（src/core/api-keys/）：用户在 dashboard 里生成、命名、撤销自己的 key，
  // API 路由用 `Authorization: Bearer sk_...` 鉴权识别用户。关闭后 /api-keys 页面、
  // 后台页和 /api/api-keys/* 都返回 404，侧边栏也没有入口；库里的 key 不删。
  apiKeys: {
    // 演示站点开着；模板出厂的 schema 默认是 false，改成 false 即可整块下线。
    enabled: true,
    // 每个 key 独立的滑动窗口限流（按 key 计数）。不填就是不限制；填了需要 Upstash Redis。
    // rateLimitPerKey: { limit: 60, window: "1 m" },
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
    // false（默认）：私有文件，只能通过有时效的签名地址访问；true：通过 R2_PUBLIC_URL 公开访问。
    // 公开模式的代价：拿到 URL 的人都能访问，且撤不回（对象仍可枚举）；签名模式多一次跳转，
    // 但用户上传的文件不该默认公开。真要做公开图床再打开，并把 R2_PUBLIC_URL 填成公开域名。
    public: false,
  },
  // 系统状态页（/status）：公开告诉访客「现在系统怎么样」，以及过去 N 天的 incident。
  // manual：管理员在 /admin/status 手动开/关 incident。auto：页面渲染时同时探测 healthUrl，
  // 同一个组件连续两次探测失败自动记为 degraded，探测恢复后自动解决（需要 features.observability）。
  // components 的 key 是存进 status_events.component 的内部 id，label 是访客看到的展示名。
  statusPage: {
    // 演示站点开着；模板出厂的 schema 默认是 false，改成 false 即可整块下线。
    enabled: true,
    mode: "manual",
    components: {
      api: {
        label: "API",
        description: "REST endpoints and webhook delivery.",
      },
      database: {
        label: "Database",
        description: "Sign-in, billing and credit records.",
      },
      ai: {
        label: "AI providers",
        description: "Model requests from the playground.",
      },
    },
    // 状态页上展示最近多少天的 uptime 和 incident。
    historyDays: 30,
  },
  // 可观测性（features.observability 开启时生效）。开启后生产环境日志是单行 JSON，带 traceId。
  // 获客能力按模块开启：渠道归因与邮箱留资见 README 的「渠道归因」「邮箱留资」两节。
  // referrals 邀请链接与积分奖励。开启邀请链接需要 features.credits 同时开启；
  // 积分奖励默认关闭（0 credits），由运营商显式配置。
  acquisition: {
    attribution: { enabled: false },
    leads: { enabled: false },
    referrals: {
      enabled: false,
      rewards: { inviterCredits: 0, inviteeCredits: 0 },
    },
  },
  // 用户面 feature flag（灰度发布）：先把新功能给自己人看，再按百分比放量。
  // 总开关关闭时 isEnabled() 恒为 false、<FeatureFlag> 不渲染 children、后台 /admin/flags 也 404。
  // v1 纯配置驱动：flag 状态不在数据库里，改完这里要重新部署（页面只读，见 /admin/flags）。
  // 评估逻辑与组件在 src/core/flags/；用法见 README 的「灰度开关」一节。
  // 演示站点关闭总开关（e2e/flags 的临时副本会把它改成 true，用同一份定义验证打开后的行为）。
  userFlags: {
    enabled: false,
    // 演示用的三个 flag；换成自己的功能开关即可，名字随便起（小写 + 短横线）。
    definitions: {
      // 灰度 50%：普通用户按分桶看到，admin 恒可见，未登录用户看不到。
      "beta-dashboard": {
        description: "New dashboard layout, rolling out to half of the users.",
        enabled: true,
        rollout: 50,
        adminOnly: false,
      },
      // 只给管理员看的预览版：rollout 0 是硬关闭，配 adminOnly 才有人能看到。
      "beta-preview": {
        description: "Preview build, admins only until it is ready.",
        enabled: true,
        rollout: 0,
        adminOnly: true,
      },
      // 单个 flag 关掉：定义留在配置里，随时能开，不必改代码。
      "beta-soon": {
        description:
          "Not shipped yet; kept here as an example of a disabled flag.",
        enabled: false,
        rollout: 100,
        adminOnly: false,
      },
    },
  },
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

// 占位哨兵：生产构建直接失败，dev 打一行警告（见 src/core/config/sentinels.ts）。
// 放在这里而不是某个组件里，是为了让 `next build` 也拦得住。
const sentinel = placeholderAction(
  placeholderIssues(config),
  process.env.NODE_ENV,
);
if (sentinel.throwMessage) throw new Error(sentinel.throwMessage);
if (sentinel.warnMessage) console.warn(sentinel.warnMessage);

export default config;
