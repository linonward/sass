import { existsSync } from "node:fs";

import { defineConfig } from "drizzle-kit";

// drizzle-kit doesn't read .env files on its own. As in Next, .env.local takes precedence and
// existing environment variables are not overwritten.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");

export default defineConfig({
  dialect: "postgresql",
  // Kit tables live in src/core/db/schema/; your app's tables in src/features/*/schema.ts.
  schema: ["./src/core/db/schema/*.ts", "./src/features/*/schema.ts"],
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
