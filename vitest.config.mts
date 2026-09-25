import { existsSync } from "node:fs";

import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// 读取 .env.local / .env（不覆盖已有变量），数据库测试从中取 DATABASE_URL_TEST。
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    // next-intl 引用 `next/navigation`（无扩展名），需经 Vite 处理才能解析。
    server: { deps: { inline: ["next-intl"] } },
  },
});
