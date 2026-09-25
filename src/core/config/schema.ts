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
      z.strictObject({
        // 名称和描述在 Landing.pricing.plans.<id>。
        id: messageKeySchema,
        // 以主币单位计的展示价格，例如 19 表示 $19。
        price: z.number().nonnegative(),
        interval: z.enum(["month", "year", "once"]),
        // 每项文案在 Landing.pricing.features.<key>。
        features: z.array(messageKeySchema).min(1),
        highlighted: z.boolean().default(false),
      }),
    )
    .refine((plans) => unique(plans.map((p) => p.id)), {
      message: "ids must not contain duplicates",
    })
    .default([]),
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
  })
  .refine((config) => config.locales.includes(config.defaultLocale), {
    message: "must be one of locales",
    path: ["defaultLocale"],
  });

export type SiteConfigInput = z.input<typeof siteConfigSchema>;
export type SiteConfig = z.output<typeof siteConfigSchema>;
export type Features = SiteConfig["features"];
export type Feature = keyof Features;
export type NavLink = z.output<typeof linkSchema>;
export type LegalInfo = SiteConfig["legal"];
export type LandingSectionId = (typeof landingSectionIds)[number];
export type LandingConfig = SiteConfig["landing"];
export type Plan = SiteConfig["billing"]["plans"][number];

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
