import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    // next-intl 引用 `next/navigation`（无扩展名），需经 Vite 处理才能解析。
    server: { deps: { inline: ["next-intl"] } },
  },
});
