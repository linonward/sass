import { z } from "zod";

import siteConfig from "../../site.config";
import { adminServerEnv } from "./admin/env";
import { aiServerEnv } from "./ai/env";
import { authServerEnv } from "./auth/env";
import { billingServerEnv } from "./billing/env";
import { createAppEnv } from "./create-env";
import { emailServerEnv } from "./email/env";
import { rateLimitServerEnv } from "./ratelimit/env";
import { uploadServerEnv } from "./upload/env";

export { createAppEnv, requiredWhen } from "./create-env";

// 各模块在自己的任务里往 server 中添加变量；只属于某个 feature 的变量用 requiredWhen 包一层。
// 模块的变量定义放在模块自己的 env.ts，便于单测而不触发这里的全局校验。
export const env = createAppEnv({
  server: {
    // Postgres 连接地址。Neon 地址（*.neon.tech）走 WebSocket 驱动，其他走 node-postgres。
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    ...emailServerEnv(process.env),
    ...authServerEnv(process.env),
    ...billingServerEnv(process.env, {
      hasPaidPlans: siteConfig.billing.plans.some((plan) => plan.price > 0),
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
      enabled:
        siteConfig.features.rateLimit ||
        siteConfig.features.ai ||
        siteConfig.features.upload,
    }),
    ...adminServerEnv(process.env, { enabled: siteConfig.features.admin }),
    ...uploadServerEnv(process.env, {
      enabled: siteConfig.features.upload,
      isPublic: siteConfig.upload.public,
    }),
  },
  runtimeEnv: process.env,
});
