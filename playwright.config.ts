import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

// Locally, read .env.local (without overwriting existing variables): the dev server, the i18n copy,
// and tests that connect to the database directly all use it. In CI the workflow env provides them.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const port = Number(process.env.E2E_PORT ?? 3000);
const baseURL = `http://localhost:${port}`;
// The multi-locale copy (see e2e/i18n/serve.ts) listens on its own port.
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
      testIgnore: ["i18n/**", "acquisition/**", "flags/**", "invoices/**"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      testIgnore: ["i18n/**", "acquisition/**", "flags/**", "invoices/**"],
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
      // CI runs `pnpm build` first, so this starts the production build directly; locally it uses
      // the dev server.
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
