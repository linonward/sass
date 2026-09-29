import { z } from "zod";

// Loaded indirectly by next.config.ts, which does not resolve the `@/` alias, so relative paths only.
import { billingProviderNames } from "../billing/env";
import { formatIssues } from "./format-issues";

const localeSchema = z
  .string()
  .regex(
    /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/,
    'must be a BCP 47 locale such as "en" or "zh-CN"',
  );

// Toggles for the example business modules (src/features/example/, src/features/invoices/).
// Shipped on by default: half the template's value is "run it and see it work". Buyers who don't
// want the examples delete them using the checklist at the end of the file.
const examplesSchema = z.strictObject({
  // Invoice CRUD example. When off, /invoices is a 404, the sidebar has no entry, and the actions
  // refuse writes.
  invoices: z.boolean().default(true),
});

export const featuresSchema = z.strictObject({
  credits: z.boolean().default(false),
  ai: z.boolean().default(false),
  blog: z.boolean().default(false),
  upload: z.boolean().default(false),
  admin: z.boolean().default(false),
  rateLimit: z.boolean().default(false),
  // Master switch for observability; the details live in the `observability` field.
  observability: z.boolean().default(false),
  examples: examplesSchema.default(examplesSchema.parse({})),
});

// Message key, matching a field under Nav in messages/<locale>.json.
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

// Entity details referenced by the legal pages (content/legal/).
export const legalSchema = z.strictObject({
  companyName: z.string().trim().min(1),
  contactEmail: z.email(),
  jurisdiction: z.string().trim().min(1),
  effectiveDate: z.iso.date('must be a date such as "2026-01-31"'),
});

// Message key (camelCase or lowercase), matching a field name in messages.
const messageKeySchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9]*$/, 'must be a message key such as "fast"');

function unique<T>(items: T[]) {
  return new Set(items).size === items.length;
}

export const landingSectionIds = [
  "hero",
  "timesaved",
  "features",
  "testimonials",
  "pricing",
  "delivery",
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

// Testimonial assets are local public/ files; no third-party embeds or remote image allowlist.
const testimonialAsset = z
  .string()
  .regex(/^\/(?!\/)[^\s]+$/, "must be a local public/ path");
const testimonialBase = z.strictObject({
  key: messageKeySchema,
  author: z.strictObject({
    name: z.string().trim().min(1),
    avatar: testimonialAsset.optional(),
  }),
  sourceUrl: z.url({ protocol: /^https$/ }).optional(),
  example: z.boolean().default(false),
});
const testimonialImage = z.strictObject({
  src: testimonialAsset,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
const testimonialItem = z.discriminatedUnion("type", [
  testimonialBase.extend({ type: z.literal("quote") }),
  testimonialBase.extend({ type: z.literal("image"), media: testimonialImage }),
  testimonialBase.extend({
    type: z.literal("video"),
    media: z.strictObject({
      src: testimonialAsset,
      poster: testimonialAsset,
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      captions: z
        .array(
          z.strictObject({
            src: testimonialAsset,
            srcLang: z.string().min(1),
            label: z.string().min(1),
          }),
        )
        .min(1),
    }),
  }),
]);

export const landingSchema = z.strictObject({
  // Which sections the home page shows, and in what order.
  sections: z
    .array(z.enum(landingSectionIds))
    .refine(unique, { message: "must not contain duplicates" })
    .default([...landingSectionIds]),
  hero: z
    .strictObject({
      // An image under public/; the copy (including alt) is in Landing.hero in messages.
      image: z
        .strictObject({
          src: z
            .string()
            .startsWith(
              "/",
              'must be a path under public/ such as "/hero.png"',
            ),
          // Image used in dark mode; must have the same dimensions as src. When omitted, both modes
          // use src.
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
  // A real site (https) built with this codebase. When set, the secondary button in the hero and
  // the closing CTA becomes "see a real example" and opens in a new tab; when unset, the secondary
  // button links to the in-site /demo.
  showcaseUrl: z.url({ protocol: /^https$/ }).optional(),
  // "Time saved" section: each item is a piece of work the template already does plus its estimated
  // hours; the total is computed automatically. Titles and descriptions are in
  // Landing.timesaved.items.<key>; an empty array hides the whole section.
  timeSaved: z
    .array(
      z.strictObject({
        key: messageKeySchema,
        hours: z.number().positive(),
      }),
    )
    .refine((items) => unique(items.map((i) => i.key)), {
      message: "keys must not contain duplicates",
    })
    .default([]),
  // Each item's title and description are in Landing.features.items.<key>.
  features: z
    .array(
      z.strictObject({
        key: messageKeySchema,
        icon: z.enum(featureIcons),
        preview: z.enum(["billing", "ai", "usage"]).optional(),
      }),
    )
    .refine((items) => unique(items.map((i) => i.key)), {
      message: "keys must not contain duplicates",
    })
    .default([]),
  // Copy is in Landing.testimonials.items.<key>; an empty array hides the whole section.
  testimonials: z
    .strictObject({
      items: z
        .array(testimonialItem)
        .refine((items) => unique(items.map((item) => item.key)), {
          message: "keys must not contain duplicates",
        })
        .default([]),
    })
    .default({ items: [] }),
  // The plan sold by the purchase card in the home page "delivery" section (the id of a paid plan
  // in billing.plans). When omitted, not found, or hidden, the card shows "coming soon" with no buy
  // button — not an error, so the site still boots if the buyer deletes that plan.
  purchasePlan: messageKeySchema.optional(),
  // Each item's question and answer are in Landing.faq.items.<key>.
  faq: z
    .array(messageKeySchema)
    .refine(unique, { message: "must not contain duplicates" })
    .default([]),
});

// Each plan has two parts: display fields on top (price, interval, feature copy), and from
// "transaction fields" down, the fields used for checkout and granting credits.
export const billingSchema = z.strictObject({
  // The payment provider that collects money. Allowed values are in src/core/billing/env.ts;
  // implementations are in src/core/billing/providers/. The BILLING_PROVIDER variable overrides it
  // at runtime (its validated default is this value). How each plan's providerProductId below is
  // interpreted follows it too: a product ID for creem, a variant ID for lemonsqueezy.
  provider: z.enum(billingProviderNames).default("creem"),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'must be an ISO 4217 code such as "USD"')
    .default("USD"),
  plans: z
    .array(
      z
        .strictObject({
          // Name and description are in Landing.pricing.plans.<id>.
          id: messageKeySchema,
          // Display price in major currency units, e.g. 19 means $19.
          price: z.number().nonnegative(),
          interval: z.enum(["month", "year", "once"]),
          // Each item's copy is in Landing.pricing.features.<key>.
          features: z.array(messageKeySchema).min(1),
          highlighted: z.boolean().default(false),
          // Not shown on the pricing or home page and can't be newly purchased, but stays in the
          // config — existing subscriptions on this plan keep renewing and keep getting credits
          // (if you delete the plan outright, renewals of old subscriptions can't find it and no
          // credits get granted).
          hidden: z.boolean().default(false),
          // —— Transaction fields ——
          // When omitted, derived from interval: once → one_time, month / year → subscription.
          type: z.enum(["subscription", "one_time"]).optional(),
          // The product ID on the provider's side: prod_* for creem, a Price's price_* for stripe.
          // Must be omitted for free plans (price 0) and is required for paid plans.
          providerProductId: z.string().trim().min(1).optional(),
          // Credits granted per purchase (one-time) or per billing period (subscription). When
          // free-plan credits are granted is up to your business logic; billing only handles paid
          // events.
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

// Sender details for transactional email; the sending domain must be verified in Resend (see the
// launch checklist in the README).
export const emailSchema = z.strictObject({
  fromName: z.string().trim().min(1),
  fromAddress: z.email(),
  replyTo: z.email().optional(),
  // Logo in the email header (a PNG or JPG under public/). Gmail and other clients don't render
  // SVG. When omitted, only the site name is shown.
  logo: z
    .string()
    .regex(
      /^\/.+\.(png|jpe?g)$/i,
      'must be a PNG or JPG path under public/ such as "/email-logo.png"',
    )
    .optional(),
});

// Sign-in parameters. Spelled out explicitly instead of relying on Better Auth plugin defaults.
export const authSchema = z.strictObject({
  emailOtp: z.strictObject({
    // Number of digits in the verification code.
    length: z.number().int().min(4).max(10),
    // Lifetime in seconds.
    expiresIn: z.number().int().positive(),
    // Allowed wrong attempts; once used up, the verification code is invalidated.
    allowedAttempts: z.number().int().positive(),
    // Minimum interval in seconds between two sends to the same email.
    resendCooldown: z.number().int().nonnegative(),
  }),
  // Changing email (`/email-otp/change-email`). With enabled off, the endpoint returns an error
  // rather than silently succeeding.
  changeEmail: z.strictObject({
    enabled: z.boolean(),
    // Whether the current email must be verified too. When off, a stolen session cookie alone is
    // enough to change the email to the attacker's.
    verifyCurrentEmail: z.boolean(),
  }),
});

// Icons for the signed-in sidebar, limited to a small set of lucide icons.
export const dashboardIcons = [
  "home",
  "settings",
  "layers",
  "sparkles",
  "fileText",
  "chart",
  "users",
  "creditCard",
  "key",
  "flag",
  "receipt",
  "download",
] as const;

// Business sidebar items; the built-in ones (Dashboard, Settings) live in src/core/dashboard.
export const dashboardSchema = z.strictObject({
  nav: z
    .array(
      z.strictObject({
        // Copy is in Dashboard.nav.<key> in messages.
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

// Credits settings; only take effect when features.credits is on.
export const creditsConfigSchema = z.strictObject({
  // When a deduction takes the balance from >= threshold to < threshold, send the credits-low email
  // (at most one per 24 hours). 0 disables the reminder.
  lowBalanceThreshold: z.number().int().nonnegative().default(100),
});

// Sliding window length, in the same format as @upstash/ratelimit's Duration, e.g. "60 s", "1 m",
// "1 h".
const durationSchema = z
  .string()
  .regex(
    /^\d+ ?(ms|s|m|h|d)$/,
    'must be a duration such as "60 s", "1 m" or "1 h"',
  )
  .refine((value) => Number.parseInt(value, 10) > 0, {
    message: "must be greater than 0",
  });

// API rate limiting (Upstash Redis). Only for endpoints like AI and upload; sign-in rate limiting is
// handled by Better Auth.
export const rateLimitConfigSchema = z.strictObject({
  // When Redis errors or times out: open lets the request through and logs an error (credit
  // deduction is the backstop); closed returns 503.
  failMode: z.enum(["open", "closed"]).default("open"),
  // Named sliding windows; each policy counts per user and per IP at once, and rejects if either is
  // over the limit.
  policies: z
    .record(
      messageKeySchema,
      z.strictObject({
        // Requests allowed per window.
        limit: z.number().int().positive(),
        window: durationSchema,
      }),
    )
    .default({
      ai: { limit: 20, window: "1 m" },
      upload: { limit: 10, window: "1 m" },
    }),
});

// User API keys (src/core/api-keys/). When off, the /api-keys page, the admin page, and the auth
// endpoint all return 404; keys in the database are not deleted (turn it back on and they work).
export const apiKeysConfigSchema = z.strictObject({
  enabled: z.boolean().default(false),
  // A separate sliding window per key: counted by key (`api_key:<keyId>`), not by user or IP.
  // Omitted (the default) means no limit. Setting it requires Upstash Redis; see
  // src/core/ratelimit/features.ts.
  rateLimitPerKey: z
    .strictObject({
      // Requests allowed per window.
      limit: z.number().int().positive(),
      window: durationSchema,
    })
    .optional(),
});

// MIME types allowed for upload and their object extensions. The extension is determined by the
// type, never taken from the user's filename. SVG and HTML are excluded: when publicly accessible
// they would execute scripts on the site's file domain.
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

// A single PUT upload is capped at 5 GiB (an S3 / R2 limit). Larger files need multipart upload,
// which v1 doesn't do.
const MAX_SINGLE_PUT_BYTES = 5 * 1024 ** 3;

// File upload (Cloudflare R2); only takes effect when features.upload is on.
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
  // Maximum size of a single file, in bytes.
  maxFileSize: z
    .number()
    .int()
    .positive()
    .max(MAX_SINGLE_PUT_BYTES, "must be at most 5 GiB (single PUT limit)")
    .default(10 * 1024 * 1024),
  // true: files are served from R2's public domain (R2_PUBLIC_URL); false: only via time-limited
  // signed URLs.
  public: z.boolean().default(false),
});

// Observability (takes effect when features.observability is on); see the "Configuration" section
// of the README for details.
export const observabilityConfigSchema = z.strictObject({
  // Log level: logs below this level are not emitted.
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // OpenTelemetry tracing (@vercel/otel).
  otel: z.boolean().default(false),
  // Sentry error reporting; requires NEXT_PUBLIC_SENTRY_DSN.
  sentry: z.boolean().default(false),
  // Sample rate (0–1) for Sentry performance tracing. When otel is also on, tracing goes to OTel
  // and this setting has no effect.
  sentryTracesSampleRate: z.number().min(0).max(1).default(0.1),
  // Vercel Analytics (page views). Enable it in the Vercel project first; see the "launch
  // checklist" in the README.
  analytics: z.boolean().default(false),
  // Vercel Speed Insights (Web Vitals). Also needs enabling in the Vercel project first.
  speedInsights: z.boolean().default(false),
});

export const aiProviders = [
  "openai",
  "anthropic",
  "google",
  // Alibaba Cloud Model Studio (DashScope): Qwen, plus models hosted there such as DeepSeek and
  // Kimi.
  "alibaba",
] as const;

// The AI SDK's reasoning call option; each provider maps it to its own thinking toggle or effort.
export const aiReasoningLevels = [
  "provider-default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

// Providers with video generation models. v1 only integrates Alibaba Cloud Model Studio (Wan).
export const aiVideoProviders = ["alibaba"] as const;

// Providers with image generation models (Anthropic has none).
export const aiImageProviders = ["openai", "google", "alibaba"] as const;

const aiModelIdSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9._-]*$/,
    'must be lowercase letters, digits, ".", "_" or "-", such as "fast"',
  );

// AI models. v1 charges a fixed amount per call: `creditCost` is the credit cost of each call, not
// billed by tokens.
export const aiConfigSchema = z
  .strictObject({
    models: z
      .array(
        z.strictObject({
          // Model ID used inside the site; the frontend and API select models by it, e.g. "fast".
          id: aiModelIdSchema,
          provider: z.enum(aiProviders),
          // The model name on the provider's side, e.g. "gpt-5-mini", "claude-haiku-4-5-20251001".
          model: z.string().trim().min(1),
          // Credits pre-deducted per call; 0 means free (doesn't require features.credits).
          creditCost: z.number().int().nonnegative(),
          // Max output tokens per call. Recommended with per-call pricing so one call's cost can't
          // run away.
          maxOutputTokens: z.number().int().positive().optional(),
          // Reasoning effort; omitted means the provider default. Some models think by default
          // (e.g. deepseek-v4 on Model Studio); with per-call pricing you can set "none" to save
          // the thinking tokens.
          reasoning: z.enum(aiReasoningLevels).optional(),
        }),
      )
      .refine((models) => unique(models.map((m) => m.id)), {
        message: "ids must not contain duplicates",
      })
      .default([]),
    // Used when a request doesn't specify a model. Required when there are models, and must be an
    // id from models.
    defaultModel: z.string().optional(),
    // Image generation models. One image per generation, with creditCost pre-deducted; results
    // are stored in R2 (requires features.upload).
    imageModels: z
      .array(
        z.strictObject({
          id: aiModelIdSchema,
          provider: z.enum(aiImageProviders),
          // The model name on the provider's side, e.g. "qwen-image-3.0", "gpt-image-1".
          model: z.string().trim().min(1),
          creditCost: z.number().int().nonnegative(),
        }),
      )
      .refine((models) => unique(models.map((m) => m.id)), {
        message: "ids must not contain duplicates",
      })
      .default([]),
    defaultImageModel: z.string().optional(),
    // Video generation models. Async jobs: creditCost is pre-deducted on submit and refunded on
    // failure or timeout; results are stored in R2. Duration and resolution are fixed in config so
    // the per-call charge matches the actual cost.
    videoModels: z
      .array(
        z.strictObject({
          id: aiModelIdSchema,
          provider: z.enum(aiVideoProviders),
          // The model name on the provider's side, e.g. "wan2.7-t2v", "wan2.7-i2v".
          model: z.string().trim().min(1),
          // text: prompt only; image: requires a first-frame image.
          input: z.enum(["text", "image"]),
          creditCost: z.number().int().nonnegative(),
          // Video duration in seconds.
          duration: z.number().int().min(2).max(15).default(5),
          resolution: z.enum(["720P", "1080P"]).default("720P"),
        }),
      )
      .refine((models) => unique(models.map((m) => m.id)), {
        message: "ids must not contain duplicates",
      })
      .default([]),
    defaultVideoModel: z.string().optional(),
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
    if (ai.videoModels.length > 0 && !ai.defaultVideoModel) {
      ctx.addIssue({
        code: "custom",
        path: ["defaultVideoModel"],
        message: "is required when videoModels is not empty",
      });
    }
    if (
      ai.defaultVideoModel &&
      !ai.videoModels.some((m) => m.id === ai.defaultVideoModel)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["defaultVideoModel"],
        message: "must be one of videoModels[].id",
      });
    }
    if (ai.imageModels.length > 0 && !ai.defaultImageModel) {
      ctx.addIssue({
        code: "custom",
        path: ["defaultImageModel"],
        message: "is required when imageModels is not empty",
      });
    }
    if (
      ai.defaultImageModel &&
      !ai.imageModels.some((m) => m.id === ai.defaultImageModel)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["defaultImageModel"],
        message: "must be one of imageModels[].id",
      });
    }
  });

// Changelog: MDX in `content/changelog/` drives the `/changelog` page and RSS. When off, both return
// 404 and the footer shows no link (see core/layout/footer-nav.ts).
export const changelogConfigSchema = z.strictObject({
  enabled: z.boolean().default(false),
});

export const acquisitionConfigSchema = z.strictObject({
  attribution: z
    .strictObject({ enabled: z.boolean().default(false) })
    .default({ enabled: false }),
  leads: z
    .strictObject({
      enabled: z.boolean().default(false),
      lists: z
        .array(
          z.strictObject({
            id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
            consentVersion: z.string().trim().min(1).max(40),
          }),
        )
        .min(1)
        .refine(
          (lists) =>
            new Set(lists.map((list) => list.id)).size === lists.length,
          "list ids must be unique",
        )
        .default([{ id: "waitlist", consentVersion: "1" }]),
    })
    .default({
      enabled: false,
      lists: [{ id: "waitlist", consentVersion: "1" }],
    }),
  referrals: z
    .strictObject({
      enabled: z.boolean().default(false),
      rewards: z
        .strictObject({
          inviterCredits: z.number().int().nonnegative().default(0),
          inviteeCredits: z.number().int().nonnegative().default(0),
          allowedPlans: z.array(z.string()).optional(),
          minPaymentByCurrency: z
            .record(z.string(), z.number().int().positive())
            .optional(),
          dailyCapPerInviter: z.number().int().nonnegative().optional(),
          monthlyCapPerInviter: z.number().int().nonnegative().optional(),
        })
        .default({
          inviterCredits: 0,
          inviteeCredits: 0,
        }),
    })
    .default({
      enabled: false,
      rewards: { inviterCredits: 0, inviteeCredits: 0 },
    }),
});

// Component id: the internal key stored in `status_events.component`. Kept separate from the
// display name so changing a label doesn't orphan historical incidents.
const statusComponentKeySchema = z
  .string()
  .regex(
    /^[a-z][a-zA-Z0-9]{0,39}$/,
    'must be a lowercase id such as "api" (letters and digits, starting with a letter)',
  );

// System status page (/status). In manual mode, admins create incidents in the admin panel. In
// auto mode the page probes `healthUrl` at render time (see src/core/status/health.ts); a component
// is marked degraded only after consecutive failures reach the threshold, and a successful probe
// automatically resolves the incident it opened.
export const statusPageSchema = z.strictObject({
  // When off, /status returns 404 and the admin panel shows no entry.
  enabled: z.boolean().default(false),
  mode: z.enum(["manual", "auto"]).default("manual"),
  // Services listed on the status page. label is the display name visitors see (a config literal,
  // not in messages).
  components: z
    .record(
      statusComponentKeySchema,
      z.strictObject({
        label: z.string().trim().min(1),
        description: z.string().trim().min(1).optional(),
        // Probe URL; components without one are still controlled manually by admins in auto mode.
        healthUrl: z
          .string()
          .regex(
            /^https?:\/\//,
            'must be an http(s) URL such as "https://example.com/health"',
          )
          .optional(),
      }),
    )
    .default({}),
  // Show uptime and incidents for the last N days.
  historyDays: z.number().int().min(1).max(365).default(30),
});

// Name of a user-facing feature flag; also the first argument to `isEnabled()`.
export const userFlagNameSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9._-]*$/,
    'must be lowercase letters, digits, ".", "_" or "-", such as "beta-dashboard"',
  );

/**
 * User-facing feature flags (gradual rollout). v1 is purely config-driven: flag state isn't stored
 * in the database, and config changes need a redeploy (`/admin/flags` shows the definitions in
 * effect). Evaluation logic is in `src/core/flags/evaluate.ts`.
 */
export const userFlagsConfigSchema = z.strictObject({
  // Master switch. When off, isEnabled() is always false, <FeatureFlag> doesn't render children,
  // and /admin/flags is a 404.
  enabled: z.boolean().default(false),
  definitions: z
    .record(
      userFlagNameSchema,
      z.strictObject({
        // Description for admins. Config text the buyer writes, shown with the flag name on
        // /admin/flags.
        description: z.string().trim().min(1).max(200),
        // Per-flag switch: keeping the definition but setting false means "not launched yet".
        enabled: z.boolean().default(false),
        // Rollout percentage 0–100. 0 is hard off (combine with adminOnly to enable it just for your
        // team), 100 is everyone.
        rollout: z.number().int().min(0).max(100).default(0),
        // Admins only: independent of rollout, admins always see it (dogfooding).
        adminOnly: z.boolean().default(false),
      }),
    )
    .default({}),
});

// Selling downloadable files (src/features/downloads/): users who buy the given plan get a license
// and can download, at /downloads, the versions released during the license period. After a
// successful payment they're emailed a link to the downloads page.
export const downloadsConfigSchema = z.strictObject({
  // Off by default: most SaaS products don't sell files. When off, /downloads and the download
  // endpoint are 404 and no license emails are sent.
  enabled: z.boolean().default(false),
  products: z
    .array(
      z.strictObject({
        // Product ID, used when publishing a version (pnpm downloads:publish <id> …); the name is in
        // Downloads.products.<id> in messages.
        id: messageKeySchema,
        // The plan that grants this product (the id of a one-time plan in billing.plans).
        planId: messageKeySchema,
        // How many months of releases the license covers; versions released afterward aren't
        // included, while already-available versions stay downloadable.
        updateMonths: z.number().int().positive(),
      }),
    )
    .refine((items) => unique(items.map((i) => i.id)), {
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
      // When unset, the built-in inline mark is used (follows primaryColor; see
      // core/layout/brand-mark.tsx). When set, that image under `public/` is used by the header,
      // sidebar, and structured data.
      logo: z
        .string()
        .startsWith("/", 'must be a path under public/ such as "/logo.svg"')
        .optional(),
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
    apiKeys: apiKeysConfigSchema.default(apiKeysConfigSchema.parse({})),
    upload: uploadConfigSchema.default(uploadConfigSchema.parse({})),
    ai: aiConfigSchema.default(aiConfigSchema.parse({})),
    acquisition: acquisitionConfigSchema.default(
      acquisitionConfigSchema.parse({}),
    ),
    statusPage: statusPageSchema.default(statusPageSchema.parse({})),
    changelog: changelogConfigSchema.default(changelogConfigSchema.parse({})),
    downloads: downloadsConfigSchema.default(downloadsConfigSchema.parse({})),
    userFlags: userFlagsConfigSchema.default(userFlagsConfigSchema.parse({})),
    observability: observabilityConfigSchema.default(
      observabilityConfigSchema.parse({}),
    ),
  })
  .refine(
    (config) =>
      !(config.statusPage.enabled && config.statusPage.mode === "auto") ||
      config.features.observability,
    {
      message: "auto mode requires features.observability",
      path: ["statusPage", "mode"],
    },
  )
  .refine(
    (config) =>
      !config.acquisition.referrals.enabled || config.features.credits,
    {
      message: "referrals requires features.credits",
      path: ["acquisition", "referrals", "enabled"],
    },
  )
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
  )
  .refine(
    (config) =>
      !config.features.ai ||
      config.features.credits ||
      config.ai.imageModels.every((m) => m.creditCost === 0),
    {
      message: "creditCost > 0 requires features.credits",
      path: ["ai", "imageModels"],
    },
  )
  .refine(
    (config) =>
      !config.features.ai ||
      config.features.credits ||
      config.ai.videoModels.every((m) => m.creditCost === 0),
    {
      message: "creditCost > 0 requires features.credits",
      path: ["ai", "videoModels"],
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
export type ChangelogConfig = SiteConfig["changelog"];
export type StatusPageConfig = SiteConfig["statusPage"];
export type StatusComponent = StatusPageConfig["components"][string];
export type StatusPageMode = StatusPageConfig["mode"];
export type RateLimitConfig = SiteConfig["rateLimit"];
export type ApiKeysConfig = SiteConfig["apiKeys"];
export type UploadConfig = SiteConfig["upload"];
export type AiConfig = SiteConfig["ai"];
export type ObservabilityConfig = SiteConfig["observability"];
export type AiModel = AiConfig["models"][number];
export type AiProvider = (typeof aiProviders)[number];
export type AiImageModel = AiConfig["imageModels"][number];
export type AiImageProvider = (typeof aiImageProviders)[number];
export type AiVideoModel = AiConfig["videoModels"][number];
export type UserFlagsConfig = SiteConfig["userFlags"];
export type UserFlagDefinition =
  UserFlagsConfig["definitions"][keyof UserFlagsConfig["definitions"]];

/** Validates `site.config.ts`. Throws on invalid config, listing each failing field. */
export function defineConfig(input: SiteConfigInput): SiteConfig {
  const result = siteConfigSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Invalid site.config.ts:\n${formatIssues(result.error.issues)}`,
    );
  }
  return result.data;
}
