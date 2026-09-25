import { z } from "zod";

import { formatIssues } from "./format-issues";

const localeSchema = z
  .string()
  .regex(
    /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/,
    'must be a BCP 47 locale such as "en" or "zh-CN"',
  );

export const featuresSchema = z.strictObject({
  credits: z.boolean().default(false),
  ai: z.boolean().default(false),
  blog: z.boolean().default(false),
  upload: z.boolean().default(false),
  admin: z.boolean().default(false),
  rateLimit: z.boolean().default(false),
});

// 文案 key，对应 messages/<locale>.json 里 Nav 下的字段。
const navKeySchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9]*$/, 'must be a message key such as "pricing"');

const linkSchema = z.strictObject({
  key: navKeySchema,
  href: z
    .string()
    .regex(/^(\/|#|https:\/\/)/, 'must start with "/", "#" or "https://"'),
});

export const navSchema = z.strictObject({
  header: z.array(linkSchema).default([]),
  footer: z
    .array(
      z.strictObject({
        key: navKeySchema,
        links: z.array(linkSchema).min(1),
      }),
    )
    .default([]),
});

// 法律页（content/legal/）中引用的主体信息。
export const legalSchema = z.strictObject({
  companyName: z.string().trim().min(1),
  contactEmail: z.email(),
  jurisdiction: z.string().trim().min(1),
  effectiveDate: z.iso.date('must be a date such as "2026-01-31"'),
});

// 文案 key（驼峰或小写），对应 messages 里的某个字段名。
const messageKeySchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9]*$/, 'must be a message key such as "fast"');

function unique<T>(items: T[]) {
  return new Set(items).size === items.length;
}

export const landingSectionIds = [
  "hero",
  "features",
  "pricing",
  "faq",
  "cta",
] as const;

export const featureIcons = [
  "zap",
  "shield",
  "globe",
  "sparkles",
  "creditCard",
  "chart",
] as const;

export const landingSchema = z.strictObject({
  // 首页显示哪些区块、按什么顺序。
  sections: z
    .array(z.enum(landingSectionIds))
    .refine(unique, { message: "must not contain duplicates" })
    .default([...landingSectionIds]),
  hero: z
    .strictObject({
      // public/ 下的图片；文案（含 alt）在 messages 的 Landing.hero。
      image: z
        .strictObject({
          src: z
            .string()
            .startsWith(
              "/",
              'must be a path under public/ such as "/hero.png"',
            ),
          // 暗色模式下使用的图片，尺寸需与 src 相同；不填则两种模式共用 src。
          darkSrc: z
            .string()
            .startsWith(
              "/",
              'must be a path under public/ such as "/hero-dark.png"',
            )
            .optional(),
          width: z.number().int().positive(),
          height: z.number().int().positive(),
        })
        .optional(),
    })
    .default({}),
  // 每项的标题和描述在 Landing.features.items.<key>。
  features: z
    .array(
      z.strictObject({ key: messageKeySchema, icon: z.enum(featureIcons) }),
    )
    .refine((items) => unique(items.map((i) => i.key)), {
      message: "keys must not contain duplicates",
    })
    .default([]),
  // 每项的问题和回答在 Landing.faq.items.<key>。
  faq: z
    .array(messageKeySchema)
    .refine(unique, { message: "must not contain duplicates" })
    .default([]),
});

// 只含展示字段；支付平台的产品 ID 等由 T301 / T303 添加。
export const billingSchema = z.strictObject({
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'must be an ISO 4217 code such as "USD"')
    .default("USD"),
  plans: z
    .array(
      z
        .strictObject({
          // 名称和描述在 Landing.pricing.plans.<id>。
          id: messageKeySchema,
          // 以主币单位计的展示价格，例如 19 表示 $19。
          price: z.number().nonnegative(),
          interval: z.enum(["month", "year", "once"]),
          // 每项文案在 Landing.pricing.features.<key>。
          features: z.array(messageKeySchema).min(1),
          highlighted: z.boolean().default(false),
          // —— 交易字段（T301）——
          // 省略时按 interval 推导：once → one_time，month / year → subscription。
          type: z.enum(["subscription", "one_time"]).optional(),
          // 支付服务商的产品 ID。免费套餐（price 为 0）不能填，付费套餐必填。
          providerProductId: z.string().trim().min(1).optional(),
          // 购买（一次性）或每个计费周期（订阅）发放的积分。免费套餐的积分何时发放由业务决定，
          // billing 只处理付费事件。
          credits: z.number().int().nonnegative().default(0),
        })
        .superRefine((plan, ctx) => {
          const expected =
            plan.interval === "once" ? "one_time" : "subscription";
          if (plan.type && plan.type !== expected) {
            ctx.addIssue({
              code: "custom",
              path: ["interval"],
              message:
                plan.type === "one_time"
                  ? 'must be "once" for one_time plans'
                  : 'must be "month" or "year" for subscription plans',
            });
          }
          if (plan.price === 0 && plan.providerProductId) {
            ctx.addIssue({
              code: "custom",
              path: ["providerProductId"],
              message: "must be omitted for free plans (price 0)",
            });
          }
          if (plan.price > 0 && !plan.providerProductId) {
            ctx.addIssue({
              code: "custom",
              path: ["providerProductId"],
              message: "is required for paid plans",
            });
          }
        })
        .transform((plan) => ({
          ...plan,
          type: (plan.interval === "once" ? "one_time" : "subscription") as
            "one_time" | "subscription",
        })),
    )
    .refine((plans) => unique(plans.map((p) => p.id)), {
      message: "ids must not contain duplicates",
    })
    .default([]),
});

// 事务邮件的发件信息；发件域名需在 Resend 验证（见 README 上线清单）。
export const emailSchema = z.strictObject({
  fromName: z.string().trim().min(1),
  fromAddress: z.email(),
  replyTo: z.email().optional(),
  // 邮件页眉的 logo（public/ 下的 PNG 或 JPG）。Gmail 等客户端不显示 SVG，不填则只显示站点名。
  logo: z
    .string()
    .regex(
      /^\/.+\.(png|jpe?g)$/i,
      'must be a PNG or JPG path under public/ such as "/email-logo.png"',
    )
    .optional(),
});

// 登录参数。显式写出，不依赖 Better Auth 插件的默认值。
export const authSchema = z.strictObject({
  emailOtp: z.strictObject({
    // 验证码位数。
    length: z.number().int().min(4).max(10),
    // 有效期（秒）。
    expiresIn: z.number().int().positive(),
    // 允许输错的次数，用完后验证码作废。
    allowedAttempts: z.number().int().positive(),
    // 同一邮箱两次发送之间的最短间隔（秒）。
    resendCooldown: z.number().int().nonnegative(),
  }),
});

// 登录后侧边栏的图标，限定在一小组 lucide 图标内。
export const dashboardIcons = [
  "home",
  "settings",
  "layers",
  "sparkles",
  "fileText",
  "chart",
  "users",
  "creditCard",
] as const;

// 业务的侧边栏菜单项；套件自带的（Dashboard、Settings）写在 src/core/dashboard 里。
export const dashboardSchema = z.strictObject({
  nav: z
    .array(
      z.strictObject({
        // 文案在 messages 的 Dashboard.nav.<key>。
        key: messageKeySchema,
        href: z
          .string()
          .regex(/^\/(?!\/)/, 'must be an in-app path such as "/projects"'),
        icon: z.enum(dashboardIcons),
      }),
    )
    .refine((items) => unique(items.map((i) => i.href)), {
      message: "hrefs must not contain duplicates",
    })
    .default([]),
});

// 积分相关的设置；只在 features.credits 开启时生效。
export const creditsConfigSchema = z.strictObject({
  // 一次扣减让余额从 >= 阈值降到 < 阈值时，发送 credits-low 邮件（24 小时内最多一封）。0 表示不提醒。
  lowBalanceThreshold: z.number().int().nonnegative().default(100),
});

// 滑动窗口时长，格式同 @upstash/ratelimit 的 Duration，例如 "60 s"、"1 m"、"1 h"。
const durationSchema = z
  .string()
  .regex(
    /^\d+ ?(ms|s|m|h|d)$/,
    'must be a duration such as "60 s", "1 m" or "1 h"',
  )
  .refine((value) => Number.parseInt(value, 10) > 0, {
    message: "must be greater than 0",
  });

// 接口限流（Upstash Redis）。只用于 AI、上传等接口；登录限流由 Better Auth 负责。
export const rateLimitConfigSchema = z.strictObject({
  // Redis 出错或超时时：open 放行并记录错误日志（积分扣减兜底），closed 返回 503。
  failMode: z.enum(["open", "closed"]).default("open"),
  // 按名称定义的滑动窗口；每条策略同时按用户和按 IP 计数，任一超限即拒绝。
  policies: z
    .record(
      messageKeySchema,
      z.strictObject({
        // 窗口内允许的请求数。
        limit: z.number().int().positive(),
        window: durationSchema,
      }),
    )
    .default({
      ai: { limit: 20, window: "1 m" },
      upload: { limit: 10, window: "1 m" },
    }),
});

// 允许上传的 MIME 类型及对应的对象扩展名。扩展名由类型决定，不取用户的文件名。
// 不含 SVG 和 HTML：公开访问时它们会在站点的文件域名下执行脚本。
export const uploadMimeTypes = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/json": "json",
  "application/zip": "zip",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "video/mp4": "mp4",
  "video/webm": "webm",
} as const;
export type UploadMimeType = keyof typeof uploadMimeTypes;

// 单次 PUT 上传的上限是 5 GiB（S3 / R2 的限制），更大的文件需要分片上传，v1 不做。
const MAX_SINGLE_PUT_BYTES = 5 * 1024 ** 3;

// 文件上传（Cloudflare R2）；只在 features.upload 开启时生效。
export const uploadConfigSchema = z.strictObject({
  allowedMimeTypes: z
    .array(
      z.enum(
        Object.keys(uploadMimeTypes) as [UploadMimeType, ...UploadMimeType[]],
      ),
    )
    .min(1)
    .refine(unique, { message: "must not contain duplicates" })
    .default(["image/png", "image/jpeg", "image/webp", "application/pdf"]),
  // 单个文件的大小上限（字节）。
  maxFileSize: z
    .number()
    .int()
    .positive()
    .max(MAX_SINGLE_PUT_BYTES, "must be at most 5 GiB (single PUT limit)")
    .default(10 * 1024 * 1024),
  // true：文件通过 R2 的公开域名访问（R2_PUBLIC_URL）；false：只能通过有时效的签名地址访问。
  public: z.boolean().default(false),
});

export const aiProviders = ["openai", "anthropic", "google"] as const;

// AI 模型。v1 按次固定扣费（见 docs/plan.md 关键决策 6）。
export const aiConfigSchema = z
  .strictObject({
    models: z
      .array(
        z.strictObject({
          // 站内使用的模型 ID，前端和接口按它选模型，例如 "fast"。
          id: z
            .string()
            .regex(
              /^[a-z0-9][a-z0-9._-]*$/,
              'must be lowercase letters, digits, ".", "_" or "-", such as "fast"',
            ),
          provider: z.enum(aiProviders),
          // 服务商那边的模型名，例如 "gpt-5-mini"、"claude-haiku-4-5-20251001"。
          model: z.string().trim().min(1),
          // 每次调用预扣的积分；0 表示免费（不需要开启 features.credits）。
          creditCost: z.number().int().nonnegative(),
          // 单次输出的 token 上限。按次计费时建议设置，避免一次调用成本失控。
          maxOutputTokens: z.number().int().positive().optional(),
        }),
      )
      .refine((models) => unique(models.map((m) => m.id)), {
        message: "ids must not contain duplicates",
      })
      .default([]),
    // 请求里没指定模型时使用。有模型时必填，且必须是 models 里的 id。
    defaultModel: z.string().optional(),
  })
  .superRefine((ai, ctx) => {
    if (ai.models.length > 0 && !ai.defaultModel) {
      ctx.addIssue({
        code: "custom",
        path: ["defaultModel"],
        message: "is required when models is not empty",
      });
    }
    if (ai.defaultModel && !ai.models.some((m) => m.id === ai.defaultModel)) {
      ctx.addIssue({
        code: "custom",
        path: ["defaultModel"],
        message: "must be one of models[].id",
      });
    }
  });

export const siteConfigSchema = z
  .strictObject({
    name: z.string().trim().min(1),
    domain: z
      .string()
      .regex(
        /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/,
        'must be a bare lowercase hostname such as "example.com" (no protocol, port or path)',
      ),
    description: z.string().trim().min(1),
    brand: z.strictObject({
      primaryColor: z
        .string()
        .regex(
          /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
          'must be a hex color such as "#4f46e5"',
        ),
      logo: z
        .string()
        .startsWith("/", 'must be a path under public/ such as "/logo.svg"'),
    }),
    locales: z
      .array(localeSchema)
      .min(1)
      .refine((locales) => new Set(locales).size === locales.length, {
        message: "must not contain duplicates",
      }),
    defaultLocale: localeSchema,
    features: featuresSchema.default(featuresSchema.parse({})),
    nav: navSchema.default(navSchema.parse({})),
    legal: legalSchema,
    landing: landingSchema.default(landingSchema.parse({})),
    billing: billingSchema.default(billingSchema.parse({})),
    email: emailSchema,
    auth: authSchema,
    dashboard: dashboardSchema.default(dashboardSchema.parse({})),
    credits: creditsConfigSchema.default(creditsConfigSchema.parse({})),
    rateLimit: rateLimitConfigSchema.default(rateLimitConfigSchema.parse({})),
    upload: uploadConfigSchema.default(uploadConfigSchema.parse({})),
    ai: aiConfigSchema.default(aiConfigSchema.parse({})),
  })
  .refine((config) => config.locales.includes(config.defaultLocale), {
    message: "must be one of locales",
    path: ["defaultLocale"],
  })
  .refine((config) => !config.features.ai || config.ai.models.length > 0, {
    message: "must not be empty when features.ai is on",
    path: ["ai", "models"],
  })
  .refine(
    (config) =>
      !config.features.ai ||
      config.features.credits ||
      config.ai.models.every((m) => m.creditCost === 0),
    {
      message: "creditCost > 0 requires features.credits",
      path: ["ai", "models"],
    },
  );

export type SiteConfigInput = z.input<typeof siteConfigSchema>;
export type SiteConfig = z.output<typeof siteConfigSchema>;
export type Features = SiteConfig["features"];
export type Feature = keyof Features;
export type NavLink = z.output<typeof linkSchema>;
export type LegalInfo = SiteConfig["legal"];
export type LandingSectionId = (typeof landingSectionIds)[number];
export type LandingConfig = SiteConfig["landing"];
export type Plan = SiteConfig["billing"]["plans"][number];
export type EmailConfig = SiteConfig["email"];
export type AuthConfig = SiteConfig["auth"];
export type DashboardIcon = (typeof dashboardIcons)[number];
export type DashboardNavItem = SiteConfig["dashboard"]["nav"][number];
export type CreditsConfig = SiteConfig["credits"];
export type RateLimitConfig = SiteConfig["rateLimit"];
export type UploadConfig = SiteConfig["upload"];
export type AiConfig = SiteConfig["ai"];
export type AiModel = AiConfig["models"][number];
export type AiProvider = (typeof aiProviders)[number];

/** 校验 `site.config.ts`。配置非法时抛错，并逐条列出出错字段。 */
export function defineConfig(input: SiteConfigInput): SiteConfig {
  const result = siteConfigSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Invalid site.config.ts:\n${formatIssues(result.error.issues)}`,
    );
  }
  return result.data;
}
