import { z } from "zod";

import siteConfig from "../../site.config";
import { adminServerEnv } from "./admin/env";
import { aiServerEnv } from "./ai/env";
import { authServerEnv } from "./auth/env";
import { billingServerEnv } from "./billing/env";
import { createAppEnv } from "./create-env";
import { emailServerEnv } from "./email/env";
import {
  observabilityClientEnv,
  observabilityServerEnv,
} from "./observability/env";
import { rateLimitServerEnv } from "./ratelimit/env";
import { rateLimitingEnabled } from "./ratelimit/features";
import { recoveryServerEnv } from "./recovery/env";
import { uploadServerEnv } from "./upload/env";

export { createAppEnv, requiredWhen } from "./create-env";

// Each module adds its variables to `server`; variables that belong to a single feature are wrapped
// in requiredWhen. A module defines its variables in its own env.ts, so they can be unit-tested without
// triggering the global validation here.
const sentryEnabled =
  siteConfig.features.observability && siteConfig.observability.sentry;

export const env = createAppEnv({
  server: {
    // Postgres connection string. Neon URLs (*.neon.tech) use the WebSocket driver; anything else uses
    // node-postgres.
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    ...emailServerEnv(process.env),
    ...authServerEnv(process.env),
    ...billingServerEnv(process.env, {
      hasPaidPlans: siteConfig.billing.plans.some((plan) => plan.price > 0),
      provider: siteConfig.billing.provider,
    }),
    ...aiServerEnv(process.env, {
      enabled: siteConfig.features.ai,
      providers: [
        ...siteConfig.ai.models.map((model) => model.provider),
        ...siteConfig.ai.imageModels.map((model) => model.provider),
        ...siteConfig.ai.videoModels.map((model) => model.provider),
      ],
    }),
    ...rateLimitServerEnv(process.env, {
      // The decision lives in src/core/ratelimit/features.ts: rate-limit wiring and the startup check use
      // the same one, so "the variables are required as if it's on" and "the runtime treats it as off"
      // can't drift apart.
      enabled: rateLimitingEnabled(),
    }),
    ...adminServerEnv(process.env, { enabled: siteConfig.features.admin }),
    ...uploadServerEnv(process.env, {
      enabled: siteConfig.features.upload,
      isPublic: siteConfig.upload.public,
    }),
    ...recoveryServerEnv(),
    ...observabilityServerEnv(),
  },
  client: observabilityClientEnv({ sentry: sentryEnabled }),
  runtimeEnv: process.env,
});
