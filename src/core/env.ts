import { z } from "zod";

import { createAppEnv } from "./create-env";

export { createAppEnv, requiredWhen } from "./create-env";

// 各模块在自己的任务里往 server 中添加变量；只属于某个 feature 的变量用 requiredWhen 包一层。
export const env = createAppEnv({
  server: {
    // Postgres 连接地址。Neon 地址（*.neon.tech）走 WebSocket 驱动，其他走 node-postgres。
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  },
  runtimeEnv: process.env,
});
