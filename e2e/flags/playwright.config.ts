import path from "node:path";
import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

for (const file of [".env.local", ".env"])
  if (existsSync(file)) process.loadEnvFile(file);
const port = Number(process.env.E2E_PORT ?? 3100) + 3;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: ".",
  outputDir: path.resolve(__dirname, "../../test-results/flags"),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [
    { name: "flags-desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "flags-mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 } },
    },
  ],
  webServer: {
    command: "node e2e/flags/serve.ts",
    cwd: path.resolve(__dirname, "../.."),
    url: baseURL,
    env: { FLAGS_PORT: String(port) },
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
