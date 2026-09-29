import path from "node:path";
import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

for (const file of [".env.local", ".env"])
  if (existsSync(file)) process.loadEnvFile(file);
// The main suite uses E2E_PORT, the i18n copy +1, attribution +2, the flags copy +3, and this one +4.
const port = Number(process.env.E2E_PORT ?? 3100) + 4;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: ".",
  outputDir: path.resolve(__dirname, "../../test-results/invoices"),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [
    { name: "invoices-desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "invoices-mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 } },
    },
  ],
  webServer: {
    command: "node e2e/invoices/serve.ts",
    cwd: path.resolve(__dirname, "../.."),
    url: baseURL,
    env: { INVOICES_PORT: String(port) },
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
