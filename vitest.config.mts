import { existsSync } from "node:fs";

import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// 读取 .env.local / .env（不覆盖已有变量），数据库测试从中取 DATABASE_URL_TEST。
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

// 会 import 全局 env（src/core/env.ts）的模块在测试里需要这些变量才能通过校验；
// 单测不会用它们连接数据库或签名真实 session。已设置时（本地 .env.local、CI）不覆盖。
const testEnvDefaults = {
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/unused",
  BETTER_AUTH_SECRET: "test-only-secret-not-for-production-use",
};

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    env: Object.fromEntries(
      Object.entries(testEnvDefaults).filter(([key]) => !process.env[key]),
    ),
    // next-intl 引用 `next/navigation`（无扩展名），需经 Vite 处理才能解析。
    server: { deps: { inline: ["next-intl"] } },
  },
});
