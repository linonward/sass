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
  // features.ai 开启时必须有模型；免费模型不要求开启 features.credits。
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

describe("dashboard", () => {
  test("省略 dashboard 时业务菜单为空", () => {
    expect(defineConfig(valid).dashboard).toEqual({ nav: [] });
  });

  test("合法的业务菜单项通过校验", () => {
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
  ])("非法字段 %s 出现在报错中", (path, nav) => {
    expect(() =>
      defineConfig({ ...valid, dashboard: { nav } } as SiteConfigInput),
    ).toThrow(`- ${path}: `);
  });
});

describe("credits", () => {
  test("lowBalanceThreshold 默认 100，可以设为 0 关闭提醒", () => {
    expect(defineConfig(valid).credits.lowBalanceThreshold).toBe(100);
    expect(
      defineConfig({ ...valid, credits: { lowBalanceThreshold: 0 } }).credits
        .lowBalanceThreshold,
    ).toBe(0);
  });

  test.each([-1, 1.5])("lowBalanceThreshold 非法值 %s 报错", (value) => {
    expect(() =>
      defineConfig({ ...valid, credits: { lowBalanceThreshold: value } }),
    ).toThrow("- credits.lowBalanceThreshold: ");
  });
});

describe("rateLimit", () => {
  test("默认 failMode 为 open，ai 每分钟 20 次、upload 每分钟 10 次", () => {
    expect(defineConfig(valid).rateLimit).toEqual({
      failMode: "open",
      policies: {
        ai: { limit: 20, window: "1 m" },
        upload: { limit: 10, window: "1 m" },
      },
    });
  });

  test("可以自定义策略和 failMode", () => {
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
  ])("非法字段 %s 出现在报错中", (path, rateLimit) => {
    expect(() =>
      defineConfig({ ...valid, rateLimit } as SiteConfigInput),
    ).toThrow(`- ${path}: `);
  });
});

describe("upload", () => {
  test("默认只允许常见图片和 PDF，上限 10 MB，私有访问", () => {
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
  ])("非法字段 %s 出现在报错中", (path, upload) => {
    expect(() => defineConfig({ ...valid, upload } as SiteConfigInput)).toThrow(
      `- ${path}: `,
    );
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

  test("省略时没有模型", () => {
    expect(
      defineConfig({ ...valid, features: undefined, ai: undefined }).ai,
    ).toEqual({ models: [], imageModels: [], videoModels: [] });
  });

  test("合法的模型列表和默认模型", () => {
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
  ])("非法字段 %s 出现在报错中", (path, ai) => {
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

    test("省略时为空，合法时保留", () => {
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
    ])("非法字段 %s 出现在报错中", (path, ai) => {
      expect(() => defineConfig(withAi({ ...base, ...ai }))).toThrow(
        `- ${path}: `,
      );
    });

    test("收费图片模型要求开启 features.credits", () => {
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

    test("时长默认 5 秒、分辨率默认 720P", () => {
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
    ])("非法字段 %s 出现在报错中", (path, ai) => {
      expect(() => defineConfig(withAi({ ...base, ...ai }))).toThrow(
        `- ${path}: `,
      );
    });
  });

  test("收费模型要求开启 features.credits，免费模型不要求", () => {
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
