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
  // With features.ai on there must be models; free models don't require features.credits.
  ai: {
    models: [
      { id: "free", provider: "openai", model: "gpt-5-mini", creditCost: 0 },
    ],
    defaultModel: "free",
  },
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
    changeEmail: { enabled: true, verifyCurrentEmail: true },
  },
};

describe("defineConfig", () => {
  test("a valid config passes; unset features default to off (except the example modules)", () => {
    const config = defineConfig(valid);
    expect(config.features).toEqual({
      credits: false,
      ai: true,
      blog: false,
      upload: false,
      admin: false,
      rateLimit: false,
      observability: false,
      // The example business modules ship on by default: the template should run and be
      // viewable out of the box. Turn them off with examples: { invoices: false }.
      examples: { invoices: true },
    });
  });

  test("omitting features turns everything off except the example modules", () => {
    const config = defineConfig({ ...valid, features: undefined });
    const { examples, ...rest } = config.features;
    expect(Object.values(rest)).not.toContain(true);
    expect(examples).toEqual({ invoices: true });
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
    [
      "features.examples.invoices",
      { features: { examples: { invoices: "yes" } } },
    ],
  ])("invalid field %s appears in the error", (path, patch) => {
    expect(() =>
      defineConfig({ ...valid, ...patch } as SiteConfigInput),
    ).toThrow(`- ${path}: `);
  });

  test("points out misspelled field names", () => {
    expect(() =>
      defineConfig({
        ...valid,
        features: { ai: true, ratelimit: true },
      } as SiteConfigInput),
    ).toThrow(/features: .*ratelimit/);
  });
});

describe("brand", () => {
  test("omitting logo is valid: the built-in mark is used and follows primaryColor", () => {
    const config = defineConfig({
      ...valid,
      brand: { primaryColor: "#4f46e5" },
    });
    expect(config.brand.logo).toBeUndefined();
  });
});

describe("nav", () => {
  test("omitting nav leaves header and footer empty", () => {
    expect(defineConfig(valid).nav).toEqual({ header: [], footer: [] });
  });

  test.each([
    ["nav.header.0.href", { header: [{ key: "a", href: "http://x.com" }] }],
    ["nav.header.0.key", { header: [{ key: "Get started", href: "/a" }] }],
    ["nav.footer.0.links", { footer: [{ key: "product", links: [] }] }],
  ])("invalid field %s appears in the error", (path, nav) => {
    expect(() => defineConfig({ ...valid, nav } as SiteConfigInput)).toThrow(
      `- ${path}: `,
    );
  });
});

describe("legal", () => {
  test("a valid legal block is kept as is", () => {
    expect(defineConfig(valid).legal.companyName).toBe("Acme Inc.");
  });

  test("errors when legal is missing", () => {
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
  ])("invalid field %s appears in the error", (path, patch) => {
    expect(() =>
      defineConfig({ ...valid, legal: { ...valid.legal!, ...patch } }),
    ).toThrow(`- ${path}: `);
  });
});

describe("email", () => {
  test("a valid email block is kept as is; logo is optional", () => {
    expect(defineConfig(valid).email).toEqual({
      fromName: "Acme",
      fromAddress: "noreply@example.com",
      replyTo: "support@example.com",
    });
  });

  test("errors when email is missing", () => {
    const { email: _email, ...rest } = valid;
    void _email;
    expect(() => defineConfig(rest as SiteConfigInput)).toThrow("- email: ");
  });

  test.each([
    ["email.fromAddress", { fromName: "A", fromAddress: "not-an-email" }],
    ["email.replyTo", { fromName: "A", fromAddress: "a@b.co", replyTo: "x" }],
    ["email.fromName", { fromName: " ", fromAddress: "a@b.co" }],
    ["email.logo", { fromName: "A", fromAddress: "a@b.co", logo: "/logo.svg" }],
  ])("invalid field %s appears in the error", (path, email) => {
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
  ])("invalid field %s appears in the error", (path, patch) => {
    expect(() =>
      defineConfig({
        ...valid,
        auth: {
          ...valid.auth,
          emailOtp: { ...valid.auth.emailOtp, ...patch },
        },
      }),
    ).toThrow(`- ${path}: `);
  });

  test("errors when auth is missing", () => {
    const rest: Partial<SiteConfigInput> = { ...valid };
    delete rest.auth;
    expect(() => defineConfig(rest as SiteConfigInput)).toThrow("- auth: ");
  });

  // Both change-email switches must be written out explicitly (no defaults); leaving one out
  // fails at startup.
  test("errors when changeEmail is missing", () => {
    expect(() =>
      defineConfig({
        ...valid,
        auth: { emailOtp: valid.auth.emailOtp },
      } as SiteConfigInput),
    ).toThrow("- auth.changeEmail: ");
  });
});

describe("dashboard", () => {
  test("omitting dashboard leaves the business menu empty", () => {
    expect(defineConfig(valid).dashboard).toEqual({ nav: [] });
  });

  test("valid business menu items pass validation", () => {
    const config = defineConfig({
      ...valid,
      dashboard: {
        nav: [{ key: "projects", href: "/projects", icon: "layers" }],
      },
    });
    expect(config.dashboard.nav).toHaveLength(1);
  });

  test.each([
    [
      "dashboard.nav.0.href",
      [{ key: "a", href: "https://x.com", icon: "home" }],
    ],
    ["dashboard.nav.0.href", [{ key: "a", href: "//x.com", icon: "home" }]],
    ["dashboard.nav.0.icon", [{ key: "a", href: "/a", icon: "rocket" }]],
    ["dashboard.nav.0.key", [{ key: "My projects", href: "/a", icon: "home" }]],
    [
      "dashboard.nav",
      [
        { key: "a", href: "/a", icon: "home" },
        { key: "b", href: "/a", icon: "home" },
      ],
    ],
  ])("invalid field %s appears in the error", (path, nav) => {
    expect(() =>
      defineConfig({ ...valid, dashboard: { nav } } as SiteConfigInput),
    ).toThrow(`- ${path}: `);
  });
});

describe("credits", () => {
  test("lowBalanceThreshold defaults to 100 and can be set to 0 to disable reminders", () => {
    expect(defineConfig(valid).credits.lowBalanceThreshold).toBe(100);
    expect(
      defineConfig({ ...valid, credits: { lowBalanceThreshold: 0 } }).credits
        .lowBalanceThreshold,
    ).toBe(0);
  });

  test.each([-1, 1.5])(
    "lowBalanceThreshold rejects invalid value %s",
    (value) => {
      expect(() =>
        defineConfig({ ...valid, credits: { lowBalanceThreshold: value } }),
      ).toThrow("- credits.lowBalanceThreshold: ");
    },
  );
});

describe("rateLimit", () => {
  test("defaults: failMode open, ai 20 per minute, upload 10 per minute", () => {
    expect(defineConfig(valid).rateLimit).toEqual({
      failMode: "open",
      policies: {
        ai: { limit: 20, window: "1 m" },
        upload: { limit: 10, window: "1 m" },
      },
    });
  });

  test("policies and failMode can be customized", () => {
    const config = defineConfig({
      ...valid,
      rateLimit: {
        failMode: "closed",
        policies: { export: { limit: 3, window: "10s" } },
      },
    });
    expect(config.rateLimit.failMode).toBe("closed");
    expect(config.rateLimit.policies).toEqual({
      export: { limit: 3, window: "10s" },
    });
  });

  test.each([
    ["rateLimit.failMode", { failMode: "reject" }],
    [
      "rateLimit.policies.ai.limit",
      { policies: { ai: { limit: 0, window: "1 m" } } },
    ],
    [
      "rateLimit.policies.ai.window",
      { policies: { ai: { limit: 1, window: "1 minute" } } },
    ],
    [
      "rateLimit.policies.ai.window",
      { policies: { ai: { limit: 1, window: "0 s" } } },
    ],
  ])("invalid field %s appears in the error", (path, rateLimit) => {
    expect(() =>
      defineConfig({ ...valid, rateLimit } as SiteConfigInput),
    ).toThrow(`- ${path}: `);
  });
});

describe("upload", () => {
  test("defaults allow only common images and PDF, 10 MB max, private access", () => {
    expect(defineConfig(valid).upload).toEqual({
      allowedMimeTypes: [
        "image/png",
        "image/jpeg",
        "image/webp",
        "application/pdf",
      ],
      maxFileSize: 10 * 1024 * 1024,
      public: false,
    });
  });

  test.each([
    ["upload.allowedMimeTypes.0", { allowedMimeTypes: ["image/svg+xml"] }],
    ["upload.allowedMimeTypes", { allowedMimeTypes: [] }],
    [
      "upload.allowedMimeTypes",
      { allowedMimeTypes: ["image/png", "image/png"] },
    ],
    ["upload.maxFileSize", { maxFileSize: 0 }],
    ["upload.maxFileSize", { maxFileSize: 6 * 1024 ** 3 }],
  ])("invalid field %s appears in the error", (path, upload) => {
    expect(() => defineConfig({ ...valid, upload } as SiteConfigInput)).toThrow(
      `- ${path}: `,
    );
  });
});

describe("observability", () => {
  test("everything is off when omitted; log level defaults to info", () => {
    expect(defineConfig(valid).observability).toEqual({
      logLevel: "info",
      otel: false,
      sentry: false,
      sentryTracesSampleRate: 0.1,
      analytics: false,
      speedInsights: false,
    });
  });

  test("Sentry sample rate must be between 0 and 1", () => {
    expect(() =>
      defineConfig({
        ...valid,
        observability: { sentryTracesSampleRate: 1.5 },
      } as unknown as SiteConfigInput),
    ).toThrow("- observability.sentryTracesSampleRate: ");
  });

  test("points out invalid log levels and misspelled fields", () => {
    expect(() =>
      defineConfig({
        ...valid,
        observability: { logLevel: "verbose" },
      } as unknown as SiteConfigInput),
    ).toThrow("- observability.logLevel: ");
    expect(() =>
      defineConfig({
        ...valid,
        observability: { otlp: true },
      } as unknown as SiteConfigInput),
    ).toThrow("observability");
  });
});

describe("ai", () => {
  const models = [
    { id: "fast", provider: "openai", model: "gpt-5-mini", creditCost: 1 },
    {
      id: "smart",
      provider: "anthropic",
      model: "claude-sonnet-5",
      creditCost: 5,
      maxOutputTokens: 4096,
    },
  ] as const;
  const withAi = (ai: unknown, features = { ai: true, credits: true }) =>
    ({ ...valid, features, ai }) as SiteConfigInput;

  test("no models when omitted", () => {
    expect(
      defineConfig({ ...valid, features: undefined, ai: undefined }).ai,
    ).toEqual({ models: [], imageModels: [], videoModels: [] });
  });

  test("a valid model list and default model", () => {
    const config = defineConfig(
      withAi({ models: [...models], defaultModel: "smart" }),
    );
    expect(config.ai.defaultModel).toBe("smart");
    expect(config.ai.models[1]?.maxOutputTokens).toBe(4096);
  });

  test.each([
    ["ai.models", { models: [models[0], models[0]], defaultModel: "fast" }],
    [
      "ai.models.0.provider",
      { models: [{ ...models[0], provider: "x" }], defaultModel: "fast" },
    ],
    [
      "ai.models.0.id",
      {
        models: [{ ...models[0], id: "Fast Model" }],
        defaultModel: "Fast Model",
      },
    ],
    [
      "ai.models.0.creditCost",
      { models: [{ ...models[0], creditCost: -1 }], defaultModel: "fast" },
    ],
    ["ai.defaultModel", { models: [...models] }],
    ["ai.defaultModel", { models: [...models], defaultModel: "nope" }],
    ["ai.models", { models: [] }],
  ])("invalid field %s appears in the error", (path, ai) => {
    expect(() => defineConfig(withAi(ai))).toThrow(`- ${path}: `);
  });

  describe("imageModels", () => {
    const image = {
      id: "qwen-image",
      provider: "alibaba",
      model: "qwen-image-3.0",
      creditCost: 5,
    } as const;
    const base = { models: [...models], defaultModel: "fast" };

    test("empty when omitted, kept when valid", () => {
      expect(defineConfig(withAi(base)).ai.imageModels).toEqual([]);
      const config = defineConfig(
        withAi({
          ...base,
          imageModels: [image],
          defaultImageModel: "qwen-image",
        }),
      );
      expect(config.ai.imageModels).toEqual([image]);
      expect(config.ai.defaultImageModel).toBe("qwen-image");
    });

    test.each([
      [
        "ai.imageModels.0.provider",
        {
          imageModels: [{ ...image, provider: "anthropic" }],
          defaultImageModel: "qwen-image",
        },
      ],
      [
        "ai.imageModels",
        { imageModels: [image, image], defaultImageModel: "qwen-image" },
      ],
      ["ai.defaultImageModel", { imageModels: [image] }],
      [
        "ai.defaultImageModel",
        { imageModels: [image], defaultImageModel: "nope" },
      ],
    ])("invalid field %s appears in the error", (path, ai) => {
      expect(() => defineConfig(withAi({ ...base, ...ai }))).toThrow(
        `- ${path}: `,
      );
    });

    test("paid image models require features.credits", () => {
      expect(() =>
        defineConfig(
          withAi(
            {
              models: [{ ...models[0], creditCost: 0 }],
              defaultModel: "fast",
              imageModels: [image],
              defaultImageModel: "qwen-image",
            },
            { ai: true, credits: false },
          ),
        ),
      ).toThrow("- ai.imageModels: creditCost > 0 requires features.credits");
    });
  });

  describe("videoModels", () => {
    const video = {
      id: "wan-i2v",
      provider: "alibaba",
      model: "wan2.7-i2v",
      input: "image",
      creditCost: 20,
    } as const;
    const base = { models: [...models], defaultModel: "fast" };

    test("duration defaults to 5 seconds and resolution to 720P", () => {
      const config = defineConfig(
        withAi({ ...base, videoModels: [video], defaultVideoModel: "wan-i2v" }),
      );
      expect(config.ai.videoModels[0]).toEqual({
        ...video,
        duration: 5,
        resolution: "720P",
      });
    });

    test.each([
      [
        "ai.videoModels.0.duration",
        {
          videoModels: [{ ...video, duration: 30 }],
          defaultVideoModel: "wan-i2v",
        },
      ],
      [
        "ai.videoModels.0.input",
        {
          videoModels: [{ ...video, input: "audio" }],
          defaultVideoModel: "wan-i2v",
        },
      ],
      [
        "ai.videoModels.0.provider",
        {
          videoModels: [{ ...video, provider: "openai" }],
          defaultVideoModel: "wan-i2v",
        },
      ],
      ["ai.defaultVideoModel", { videoModels: [video] }],
      [
        "ai.defaultVideoModel",
        { videoModels: [video], defaultVideoModel: "nope" },
      ],
    ])("invalid field %s appears in the error", (path, ai) => {
      expect(() => defineConfig(withAi({ ...base, ...ai }))).toThrow(
        `- ${path}: `,
      );
    });
  });

  test("paid models require features.credits; free models don't", () => {
    expect(() =>
      defineConfig(
        withAi(
          { models: [...models], defaultModel: "fast" },
          { ai: true, credits: false },
        ),
      ),
    ).toThrow("- ai.models: creditCost > 0 requires features.credits");
    expect(() =>
      defineConfig(
        withAi(
          { models: [{ ...models[0], creditCost: 0 }], defaultModel: "fast" },
          { ai: true, credits: false },
        ),
      ),
    ).not.toThrow();
  });
});

describe("acquisition configuration", () => {
  test("defaults all modules off and allows independent attribution/leads", () => {
    expect(defineConfig(valid).acquisition).toEqual({
      attribution: { enabled: false },
      leads: {
        enabled: false,
        lists: [{ id: "waitlist", consentVersion: "1" }],
      },
      referrals: {
        enabled: false,
        rewards: { inviterCredits: 0, inviteeCredits: 0 },
      },
    });
    expect(
      defineConfig({ ...valid, acquisition: { leads: { enabled: true } } })
        .acquisition.attribution.enabled,
    ).toBe(false);
  });
  test("referrals require credits, without requiring attribution", () => {
    expect(() =>
      defineConfig({ ...valid, acquisition: { referrals: { enabled: true } } }),
    ).toThrow();
    expect(
      defineConfig({
        ...valid,
        features: { credits: true },
        acquisition: { referrals: { enabled: true } },
      }).acquisition.attribution.enabled,
    ).toBe(false);
  });
});
