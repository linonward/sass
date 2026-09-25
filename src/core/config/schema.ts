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

const linkSchema = z.strictObject({
  label: z.string().trim().min(1),
  href: z
    .string()
    .regex(/^(\/|#|https:\/\/)/, 'must start with "/", "#" or "https://"'),
});

export const navSchema = z.strictObject({
  header: z.array(linkSchema).default([]),
  footer: z
    .array(
      z.strictObject({
        title: z.string().trim().min(1),
        links: z.array(linkSchema).min(1),
      }),
    )
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
