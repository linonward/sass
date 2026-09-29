import { existsSync } from "node:fs";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Read .env.local / .env (without overwriting existing variables); database tests take
// DATABASE_URL_TEST from there.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

// Modules that import the global env (src/core/env.ts) need these variables to pass validation in
// tests; unit tests never use them to connect to a database or sign real sessions. Not overridden
// when already set (local .env.local, CI).
const testEnvDefaults = {
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/unused",
  BETTER_AUTH_SECRET: "test-only-secret-not-for-production-use",
};

export default defineConfig({
  // Vite resolves tsconfig paths natively (reading `paths` from the root tsconfig.json: `@/*` and
  // `content-collections`), so the vite-tsconfig-paths plugin is no longer needed.
  resolve: { tsconfigPaths: true },
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    env: Object.fromEntries(
      Object.entries(testEnvDefaults).filter(([key]) => !process.env[key]),
    ),
    // next-intl imports `next/navigation` (without an extension), which only resolves when Vite
    // processes it.
    server: { deps: { inline: ["next-intl"] } },
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/testing.{ts,tsx}",
        "src/**/test-utils.{ts,tsx}",
        "src/**/testing/**",
      ],
      thresholds: {
        // Set slightly below the current baseline (~40%) to catch regressions without blocking new
        // code. Raise these gradually as coverage improves; see the coverage report for current
        // values.
        lines: 35,
        branches: 30,
        functions: 35,
        statements: 35,
      },
      reporter: ["text", "lcov"],
    },
  },
});
