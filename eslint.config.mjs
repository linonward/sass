import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  // 套件代码统一用 logger（src/core/observability），不直接 console.error / warn。
  // console.info 留给开发环境打印邮件内容等本地提示；测试里的跳过提示不受限制。
  {
    files: ["src/core/**/*.{ts,tsx}"],
    ignores: [
      "src/core/**/*.test.{ts,tsx}",
      "src/core/observability/logger.ts",
    ],
    rules: { "no-console": ["error", { allow: ["info"] }] },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    // content-collections 生成的文章数据
    ".content-collections/**",
  ]),
]);

export default eslintConfig;
