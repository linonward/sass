import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

// 本地读取 .env.local（不覆盖已有变量）：dev server、i18n 副本和需要直连数据库的用例都用它。
// CI 通过 workflow 的 env 提供。
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const port = Number(process.env.E2E_PORT ?? 3000);
const baseURL = `http://localhost:${port}`;
// 多语言副本（见 e2e/i18n/serve.ts）单独监听一个端口。
const i18nPort = port + 1;
const i18nBaseURL = `http://localhost:${i18nPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop",
      testIgnore: "i18n/**",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      testIgnore: "i18n/**",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "i18n",
      testMatch: "i18n/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: i18nBaseURL },
    },
  ],
  webServer: [
    {
      // CI 先执行 `pnpm build`，这里直接启动生产构建；本地用开发服务器。
      command: process.env.CI ? `pnpm start -p ${port}` : `pnpm dev -p ${port}`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "node e2e/i18n/serve.ts",
      url: i18nBaseURL,
      env: { I18N_PORT: String(i18nPort) },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
