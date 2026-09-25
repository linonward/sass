import { z } from "zod";

import { authServerEnv } from "./auth/env";
import { createAppEnv } from "./create-env";
import { emailServerEnv } from "./email/env";

export { createAppEnv, requiredWhen } from "./create-env";

// 各模块在自己的任务里往 server 中添加变量；只属于某个 feature 的变量用 requiredWhen 包一层。
// 模块的变量定义放在模块自己的 env.ts，便于单测而不触发这里的全局校验。
export const env = createAppEnv({
  server: {
    // Postgres 连接地址。Neon 地址（*.neon.tech）走 WebSocket 驱动，其他走 node-postgres。
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    ...emailServerEnv(process.env),
    ...authServerEnv(process.env),
  },
  runtimeEnv: process.env,
});
