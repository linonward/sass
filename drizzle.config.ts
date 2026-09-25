import { existsSync } from "node:fs";

import { defineConfig } from "drizzle-kit";

// drizzle-kit 不会自动读取 .env 文件；与 Next 一致，.env.local 优先，已有的环境变量不被覆盖。
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");

export default defineConfig({
  dialect: "postgresql",
  // 套件的表在 src/core/db/schema/，业务的表在 src/features/*/schema.ts。
  schema: ["./src/core/db/schema/*.ts", "./src/features/*/schema.ts"],
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
