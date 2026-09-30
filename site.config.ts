import {
  firstPlaceholderWarning,
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
 * Site configuration. Edit the literals in this file directly.
 *
 * Nine fields can also be overridden by environment variables. Each one is written as
 * `envOverride(VAR_NAME) ?? placeholder literal`:
 * `name` and `email.fromName` (both from `SITE_NAME`, see siteName below), `domain` (`SITE_DOMAIN`), `email.fromAddress` (`SITE_EMAIL_FROM`),
 * `legal.companyName` (`SITE_LEGAL_NAME`), `legal.contactEmail` and `email.replyTo` (both from
 * `SITE_CONTACT_EMAIL`, see contactEmail below), and the `providerProductId` of the two paid plans
 * (the variable name follows the active payment provider, see effectiveBillingProvider below:
 * creem uses `CREEM_PRODUCT_ID_PRO` / `CREEM_PRODUCT_ID_LIFETIME`, stripe uses
 * `STRIPE_PRICE_ID_PRO` / `STRIPE_PRICE_ID_LIFETIME`, lemonsqueezy uses
 * `LEMONSQUEEZY_VARIANT_ID_PRO` / `LEMONSQUEEZY_VARIANT_ID_LIFETIME`).
 * The template only ships placeholder values; keep your real domain, name, and product IDs in
 * the deployment environment. Without these variables you get the placeholder config.
 *
 * A few more overrides exist for when a deployed site should differ from the template defaults
 * (for example, your own site sells only some plans or at a different price, and you don't want
 * to change the defaults everyone else gets): `SITE_PRICE_<PLAN ID IN UPPERCASE>` overrides the
 * list price (`SITE_PRICE_LIFETIME=99`), `SITE_HIDDEN_PLANS` hides a comma-separated list of
 * plans (`SITE_HIDDEN_PLANS=pro`, see `hidden` on plans), `SITE_DOWNLOADS=1` turns on
 * selling downloadable files (see downloads), `SITE_DESCRIPTION` replaces `description`, and
 * `SITE_OVERLAY_DIR` swaps in a different home page (`landing`, `nav` and their copy) from a
 * directory, see src/core/config/overlay.ts.
 * Fields without a matching variable (colors, copy) can only be changed in this file.
 */
const envOverride = (name: string): string | undefined => {
  // An empty value counts as "not set", matching emptyStringAsUndefined in src/core/create-env.ts:
  // these variables ship empty in .env.example, and copying it to .env.local must not turn the
  // config into empty strings.
  const value = process.env[name]?.trim();
  return value === "" ? undefined : value;
};

/**
 * `SITE_PRICE_<PLAN>`: overrides the list price (in major currency units). If it is set but is
 * not a non-negative number, startup fails instead of silently falling back to the default price.
 */
const envPrice = (planId: string, fallback: number): number => {
  const name = `SITE_PRICE_${planId.toUpperCase()}`;
  const value = envOverride(name);
  if (value === undefined) return fallback;
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) {
    throw new Error(`${name} must be a non-negative number, got "${value}"`);
  }
  return price;
};

/**
 * `SITE_HIDDEN_PLANS`: comma-separated plan ids. These plans are not shown and cannot be newly
 * purchased (existing subscriptions are unaffected).
 */
const hiddenPlans = new Set(
  (envOverride("SITE_HIDDEN_PLANS") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);
const isHidden = (planId: string) => hiddenPlans.has(planId);

/**
 * `SITE_DOWNLOADS=1`: turns on selling downloadable files (downloads.enabled). The official site
 * uses it to deliver this template; it is off by default.
 */
const downloadsEnabled = envOverride("SITE_DOWNLOADS") === "1";

/**
 * The payment provider that takes payments. Change the literal here (this is also the default
 * used for type checking); at runtime `BILLING_PROVIDER` overrides it, and the environment
 * variable wins.
 */
const billingProvider: BillingProviderName = "creem";

/**
 * The active provider: the provider above can be overridden at runtime by `BILLING_PROVIDER`,
 * using the same logic as src/core/billing/env.ts (fake is not a real provider and is ignored;
 * only creem / stripe / lemonsqueezy / waffo override it).
 */
const effectiveBillingProvider: BillingProviderName =
  billingProviderNames.find((name) => name === process.env.BILLING_PROVIDER) ??
  billingProvider;

/**
 * Environment variable prefix for plan product IDs. It follows the active provider, so when you
 * switch providers the product ID variable names switch too and you don't have to keep two sets
 * in mind. Creem's prod_*, Stripe's price_* and Lemon Squeezy's variants are different objects in
 * each dashboard — with Lemon Squeezy, `providerProductId` holds the **variant** ID.
 */
const productIdEnvPrefix: Record<BillingProviderName, string> = {
  creem: "CREEM_PRODUCT_ID",
  stripe: "STRIPE_PRICE_ID",
  lemonsqueezy: "LEMONSQUEEZY_VARIANT_ID",
  // Waffo Pancake product IDs (`PROD_…`); separate sets for test and prod.
  waffo: "WAFFO_PRODUCT_ID",
};

/**
 * Placeholder product ID used when no environment variable is set. It is a **provider-agnostic
 * sentinel**: src/core/billing/checkout.ts rejects the `prod_placeholder_` prefix, so checkout
 * fails right away instead of calling the provider with a fake ID.
 */
const placeholderProductId = (plan: string) => `prod_placeholder_${plan}`;

/**
 * The product name. It is also the default sender name of transactional email (`email.fromName`),
 * so `SITE_NAME` renames the site and the "From" line together; give `fromName` its own literal if
 * mail should come from a different name (e.g. "Acme Support").
 */
const siteName = envOverride("SITE_NAME") ?? "Acme";

/**
 * The address people write to: shown on the legal pages (`legal.contactEmail`) and used as the
 * Reply-To of transactional email (`email.replyTo`). One variable feeds both so a reply to a
 * sign-in code lands in the same inbox the privacy policy points to. If you want them to differ,
 * give either field its own literal.
 */
const contactEmail = envOverride("SITE_CONTACT_EMAIL") ?? "support@example.com";

const config = defineConfig({
  name: siteName,
  // Placeholder domain; change it to your own (without the protocol). The demo site overrides it
  // with SITE_DOMAIN.
  domain: envOverride("SITE_DOMAIN") ?? "example.com",
  // One sentence about the product: the default description in search results, share cards and
  // llms.txt.
  description:
    envOverride("SITE_DESCRIPTION") ??
    "Studio-quality product photos from a single snapshot.",
  brand: {
    primaryColor: "#0f766e",
  },
  // The **values** of the locale list live in src/core/i18n/locales.ts (they don't go through zod,
  // see the comment in that file). They are imported here so the schema validates them, so that
  // file stays the single source. To change locales, edit that file.
  locales,
  defaultLocale,
  features: {
    // The demo site turns on credits, AI, blog, file upload, and admin; credits are granted
    // according to `credits` on billing.plans.
    // Admin at /admin: sign in with an email listed in ADMIN_EMAILS to become an admin.
    // Blog posts go in content/blog/<locale>/<slug>.mdx; see content-collections.ts for fields.
    credits: true,
    ai: true,
    blog: true,
    upload: true,
    admin: true,
    // Policies are in rateLimit below. When Redis is not configured: local, CI, and Vercel
    // previews let requests through (failMode open as the fallback); self-hosted production
    // (NODE_ENV=production and not on Vercel) rejects requests and logs an error, so it never
    // silently becomes unlimited. If you really don't want rate limiting, set ALLOW_UNRATELIMITED=1.
    rateLimit: true,
    // Structured logging, tracing, and analytics; details in observability below.
    observability: true,
    // Example business module: invoice CRUD (src/features/invoices/). When off, /invoices returns
    // 404 and the sidebar has no entry; the checklist for deleting the whole example is at the
    // end of src/features/invoices/schema.ts.
    examples: { invoices: true },
  },
  nav: {
    header: [
      { key: "features", href: "/#features" },
      { key: "pricing", href: "/#pricing" },
      { key: "faq", href: "/#faq" },
      // Remove the Blog link as well when you turn off features.blog.
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
          // Hidden automatically when changelog.enabled is off (see src/core/layout/footer-nav.ts);
          // no need to delete it by hand.
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
  // Company details referenced by the legal pages (content/legal/). Change them to your own
  // before launch.
  legal: {
    companyName: envOverride("SITE_LEGAL_NAME") ?? "Acme Inc.",
    contactEmail,
    jurisdiction: "the State of Delaware, United States",
    effectiveDate: "2026-01-01",
  },
  // The home page. The shipped copy describes a made-up AI product-photo tool called Acme so every
  // section shows a realistic product page; replace the copy in messages (Landing.*) with your own.
  landing: {
    sections: ["hero", "features", "testimonials", "pricing", "faq", "cta"],
    // Leave this off for a product site: buttons then lead to sign-in and pricing. Turn it on to
    // point visitors at the in-site /demo instead.
    demo: false,
    // Sells one plan from the "delivery" section: add "delivery" to `sections`, set the plan id
    // here (for example "lifetime"), and list what's included in `deliverables` (copy in
    // Landing.delivery.items.<key>). With a purchasable plan, the hero's primary button becomes
    // "Buy now · price". When the plan is hidden, the card shows "coming soon".
    // purchasePlan: "lifetime",
    // deliverables: ["credits", "commercial", "support"],
    // Without an `image` on hero, the right side of the first screen renders a product mock built
    // from real DOM (AI studio + credit transactions, clearly labeled as sample data, no model
    // calls). To switch back to a static image, add image: { src, darkSrc?, width, height } under
    // hero; put the image in public/, and the alt text lives in Landing.hero.imageAlt in messages.
    // `stepIcons` picks the icons of the three steps under the hero (copy in Landing.hero.steps);
    // `colorSwitcher: true` adds brand color swatches under the buttons.
    hero: {
      stepIcons: ["upload", "sparkles", "download"],
    },
    // Once a real site built with this code is live, put its URL here (https); the secondary hero
    // button then becomes "see a real example".
    // showcaseUrl: "https://…",
    // "Time saved" section (add "timesaved" to `sections`): each item is a key in
    // Landing.timesaved.items plus its estimated hours; the total is computed automatically.
    // timeSaved: [
    //   { key: "studio", hours: 4 },
    //   { key: "shoot", hours: 3 },
    //   { key: "retouch", hours: 2 },
    // ],
    features: [
      { key: "studio", icon: "sparkles", preview: "ai" },
      { key: "credits", icon: "creditCard", preview: "billing" },
      { key: "history", icon: "chart", preview: "usage" },
    ],
    // Sample testimonials are not customer endorsements. After replacing them with real,
    // authorized testimonials, remove `example` from each item.
    // Reorder or turn off sections with `sections`; emptying `items` also hides the section
    // without leaving an empty colored band.
    // Body text, author identity, and image alt text live in Landing.testimonials.items.<key> in
    // messages. Put image/video assets and avatars in public/; a video must have a poster,
    // dimensions, and captions.
    testimonials: {
      items: [
        {
          key: "listings",
          type: "quote",
          example: true,
          author: { name: "Customer A" },
        },
        {
          key: "launch",
          type: "image",
          example: true,
          author: { name: "Customer B" },
          media: { src: "/landing/perfume.webp", width: 1536, height: 1024 },
        },
        {
          key: "catalog",
          type: "quote",
          example: true,
          author: { name: "Customer C" },
        },
        {
          key: "ads",
          type: "quote",
          example: true,
          author: { name: "Customer D" },
        },
        {
          key: "skincare",
          type: "image",
          example: true,
          author: { name: "Customer E" },
          media: { src: "/landing/skincare.webp", width: 1122, height: 1402 },
        },
        {
          key: "social",
          type: "quote",
          example: true,
          author: { name: "Customer F" },
        },
      ],
    },
    faq: ["photos", "rights", "credits", "failed", "cancel", "refund"],
  },
  billing: {
    // Payment provider. Before changing it, read the "Payments" parts of the launch checklist in
    // the README: each provider needs different environment variables.
    provider: billingProvider,
    currency: "USD",
    plans: [
      {
        id: "free",
        price: 0,
        hidden: isHidden("free"),
        interval: "month",
        features: ["credits100", "coreFeatures", "communitySupport"],
        credits: 100,
      },
      {
        id: "pro",
        price: envPrice("pro", 19),
        hidden: isHidden("pro"),
        interval: "month",
        features: ["credits2000", "coreFeatures", "prioritySupport"],
        highlighted: true,
        // The product ID on the provider's side (see productIdEnvPrefix above; with Lemon
        // Squeezy it is the variant ID). The placeholder cannot be used for checkout (see
        // src/core/billing/checkout.ts); replace it with your own product ID, or override it with
        // the variable for the billingProvider above. Test mode and live mode have different
        // product IDs, so switch them together when you switch modes (see the README launch
        // checklist).
        providerProductId:
          envOverride(`${productIdEnvPrefix[effectiveBillingProvider]}_PRO`) ??
          placeholderProductId("pro"),
        credits: 2000,
      },
      {
        id: "lifetime",
        price: envPrice("lifetime", 199),
        hidden: isHidden("lifetime"),
        interval: "once",
        features: ["credits2000", "coreFeatures", "lifetimeUpdates"],
        // Same as above: a one-time product, overridden with `..._LIFETIME`.
        providerProductId:
          envOverride(
            `${productIdEnvPrefix[effectiveBillingProvider]}_LIFETIME`,
          ) ?? placeholderProductId("lifetime"),
        credits: 2000,
      },
    ],
  },
  // Sender details for transactional email (sign-in verification codes, welcome email, etc.).
  // The sending domain must be verified in Resend.
  email: {
    // Follows SITE_NAME (see siteName above).
    fromName: siteName,
    // Change to a sender address you have verified in Resend; the demo site overrides it with
    // SITE_EMAIL_FROM.
    fromAddress: envOverride("SITE_EMAIL_FROM") ?? "noreply@example.com",
    // Follows SITE_CONTACT_EMAIL (see contactEmail above).
    replyTo: contactEmail,
  },
  // Settings for email verification-code sign-in (set explicitly rather than relying on plugin
  // defaults). expiresIn and resendCooldown are in seconds.
  auth: {
    emailOtp: {
      length: 6,
      expiresIn: 300,
      allowedAttempts: 3,
      resendCooldown: 60,
    },
    // Changing email (`/email-otp/change-email` and related endpoints; the settings page has no
    // entry for it yet). verifyCurrentEmail also sends a code to the current address, and the
    // change only goes through with both codes — someone who has only stolen the session cookie
    // can't change the email, which would otherwise mean handing over the account. After a
    // successful change, all of that user's sessions are invalidated immediately
    // (see src/core/auth/session-invalidation.ts).
    changeEmail: {
      enabled: true,
      verifyCurrentEmail: true,
    },
  },
  // Your own menu items in the signed-in sidebar; the labels live in Dashboard.nav.<key> in
  // messages. For example { key: "projects", href: "/projects", icon: "layers" }; these paths
  // require sign-in automatically. App pages that are not in the sidebar (placed under (app)) are
  // also protected by the layout, but the redirect to sign-in doesn't carry a return URL.
  dashboard: {
    nav: [
      // Downloads page (src/features/downloads/): only shown when downloads.enabled is on.
      ...(downloadsEnabled
        ? [{ key: "downloads", href: "/downloads", icon: "download" as const }]
        : []),
      // First-run checklist (src/core/onboarding/): users land on it once after sign-up and can
      // come back here anytime. It is a kit page, but its entry sits with the app menu items so
      // the sidebar order has a single source.
      { key: "onboarding", href: "/onboarding", icon: "fileText" },
      // Example business module (src/features/example/). Remove this item when you delete the
      // example.
      { key: "example", href: "/example", icon: "sparkles" },
    ],
  },
  credits: {
    // When the balance drops below this value, the user is reminded to top up (credits-low email).
    lowBalanceThreshold: 100,
  },
  // Changelog. Entries go in content/changelog/<slug>.mdx; see content-collections.ts for fields.
  // When disabled, /changelog and /changelog/rss.xml return 404 and the footer hides the link.
  changelog: {
    enabled: true,
  },
  // Selling downloadable files (src/features/downloads/). The official site uses it to deliver
  // this template: set SITE_DOWNLOADS=1 to turn it on. Leave it off if you don't sell files.
  // Publish a new version with pnpm downloads:publish <product id> <version> <file>.
  downloads: {
    enabled: downloadsEnabled,
    products: [{ id: "template", planId: "lifetime", updateMonths: 12 }],
  },
  // API rate limits (AI, upload, checkout), counted in Upstash Redis. Each policy counts both per
  // user and per IP.
  rateLimit: {
    // When Redis errors: "open" lets requests through (credit deduction is the backstop),
    // "closed" returns 503. This covers "Redis is configured but the request failed"; for Redis
    // not being configured at all, see the note on features.rateLimit.
    failMode: "open",
    policies: {
      ai: { limit: 20, window: "1 m" },
      upload: { limit: 10, window: "1 m" },
      // Checkout sessions: every call creates a real order on the provider's side, so this stops
      // scripts from creating them in a loop (double clicks are handled by idempotency/locking).
      checkout: { limit: 5, window: "1 m" },
      // Status page email subscriptions: each submission may send a confirmation email; counting
      // per IP is enough.
      statusSubscribe: { limit: 5, window: "1 h" },
      // Referral link accept endpoint (reachable without signing in): each call is just one
      // lookup by code; counting per IP is enough.
      referralAccept: { limit: 30, window: "1 h" },
    },
  },
  // User API keys (src/core/api-keys/): users create, name, and revoke their own keys in the
  // dashboard, and API routes identify the user via `Authorization: Bearer sk_...`. When
  // disabled, the /api-keys page, the admin page, and /api/api-keys/* all return 404 and the
  // sidebar has no entry; keys in the database are not deleted.
  apiKeys: {
    // On for the demo site; the schema default in the template is false. Set it to false to turn
    // the whole feature off.
    enabled: true,
    // A separate sliding-window rate limit per key (counted per key). Omit it for no limit;
    // setting it requires Upstash Redis.
    // rateLimitPerKey: { limit: 60, window: "1 m" },
  },
  // File upload (Cloudflare R2). Only takes effect when features.upload is on; SVG and HTML are
  // not among the allowed types.
  upload: {
    allowedMimeTypes: [
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/pdf",
    ],
    // Maximum size of a single file, in bytes.
    maxFileSize: 10 * 1024 * 1024,
    // false (default): private files, only reachable through time-limited signed URLs; true:
    // publicly reachable through R2_PUBLIC_URL. The cost of public mode: anyone with the URL can
    // access the file and you can't take that back (objects can still be enumerated); signed mode
    // adds one redirect, but user uploads shouldn't be public by default. Only turn this on if
    // you really are building public image hosting, and set R2_PUBLIC_URL to the public domain.
    public: false,
  },
  // System status page (/status): tells visitors publicly how the system is doing right now and
  // shows incidents from the last N days.
  // manual: admins open/close incidents by hand at /admin/status. auto: rendering the page also
  // probes healthUrl; two consecutive failed probes of the same component mark it degraded, and
  // it resolves automatically once probes recover (requires features.observability).
  // The keys of `components` are internal ids stored in status_events.component; `label` is the
  // display name visitors see.
  statusPage: {
    // On for the demo site; the schema default in the template is false. Set it to false to turn
    // the whole feature off.
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
    // How many days of uptime and incidents the status page shows.
    historyDays: 30,
  },
  // Acquisition features are turned on per module: see the "Channel attribution" and "Email lead
  // capture" sections of the README.
  // referrals: referral links and credit rewards. Referral links require features.credits to be
  // on as well; credit rewards are off by default (0 credits) and must be configured explicitly
  // by the operator.
  acquisition: {
    attribution: { enabled: false },
    leads: { enabled: false },
    referrals: {
      enabled: false,
      rewards: { inviterCredits: 0, inviteeCredits: 0 },
    },
  },
  // User-facing feature flags (gradual rollout): show a new feature to your own team first, then
  // roll it out by percentage.
  // When the master switch is off, isEnabled() always returns false, <FeatureFlag> doesn't render
  // its children, and the admin page /admin/flags returns 404.
  // v1 is purely config-driven: flag state is not in the database, so changes here need a
  // redeploy (the admin page is read-only, see /admin/flags).
  // Evaluation logic and components live in src/core/flags/; usage is in the "Feature flags"
  // section of the README.
  // The demo site keeps the master switch off (a temporary copy made by e2e/flags sets it to true
  // to test the enabled behavior with the same definitions).
  userFlags: {
    enabled: false,
    // Three demo flags; replace them with your own feature flags. Name them however you like
    // (lowercase + hyphens).
    definitions: {
      // 50% rollout: regular users see it based on their bucket, admins always see it, signed-out
      // users never do.
      "beta-dashboard": {
        description: "New dashboard layout, rolling out to half of the users.",
        enabled: true,
        rollout: 50,
        adminOnly: false,
      },
      // Admin-only preview: rollout 0 is a hard off, so adminOnly is what lets anyone see it.
      "beta-preview": {
        description: "Preview build, admins only until it is ready.",
        enabled: true,
        rollout: 0,
        adminOnly: true,
      },
      // A single flag turned off: the definition stays in the config and can be turned on anytime
      // without code changes.
      "beta-soon": {
        description:
          "Not shipped yet; kept here as an example of a disabled flag.",
        enabled: false,
        rollout: 100,
        adminOnly: false,
      },
    },
  },
  // Observability (takes effect when features.observability is on). When on, production logs are
  // single-line JSON with a traceId.
  observability: {
    logLevel: "info",
    // OpenTelemetry tracing: on Vercel, enable Tracing or the OTel integration; elsewhere set
    // OTEL_EXPORTER_OTLP_ENDPOINT.
    otel: false,
    // Sentry error reporting: when on, set NEXT_PUBLIC_SENTRY_DSN; also setting SENTRY_AUTH_TOKEN /
    // SENTRY_ORG / SENTRY_PROJECT uploads source maps at build time. Only the user ID is sent,
    // never email or IP.
    sentry: false,
    // Vercel Analytics (page views and conversion events) and Speed Insights; both must be enabled
    // in your Vercel project first. Custom events (sign_up, checkout_started, purchase) require the
    // Pro plan; Hobby only gets page views.
    analytics: true,
    speedInsights: true,
  },
  // AI models (take effect when features.ai is on). Each call reserves creditCost credits up
  // front and refunds them on failure.
  // If env only has keys for some providers, model calls to other providers return 503; in
  // production, a key is required for every provider used here.
  ai: {
    // The demo site only uses Alibaba Cloud Model Studio (ALIBABA_API_KEY); to use OpenAI,
    // Anthropic, or Google instead, change provider and model.
    // These models have thinking on by default on Model Studio; lightweight per-call models turn
    // it off with reasoning: "none".
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
    // Image models (also require features.upload: results are stored in R2). Set creditCost
    // based on the provider's per-image price.
    imageModels: [
      {
        id: "qwen-image",
        provider: "alibaba",
        model: "qwen-image-3.0",
        creditCost: 5,
        // qwen-image-3.0 also edits: pass one of the user's uploaded images as a reference.
        acceptsImage: true,
      },
      {
        id: "wan-image",
        provider: "alibaba",
        model: "wan2.7-image-pro",
        creditCost: 10,
      },
    ],
    defaultImageModel: "qwen-image",
    // Video models (also require features.upload). Generated asynchronously with a fixed duration
    // and resolution, charged per generation.
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

// Placeholder sentinel: production builds fail outright, dev prints a one-line warning (see
// src/core/config/sentinels.ts). It lives here rather than in a component so `next build` catches
// it too.
const sentinel = placeholderAction(
  placeholderIssues(config),
  process.env.NODE_ENV,
);
if (sentinel.throwMessage) throw new Error(sentinel.throwMessage);
if (sentinel.warnMessage && firstPlaceholderWarning()) {
  console.warn(sentinel.warnMessage);
}

export default config;
