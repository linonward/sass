import os from "node:os";
import path from "node:path";

// e2e 用的测试语言，内容由 serve.ts 从 en.json 伪翻译生成。
export const TEST_LOCALE = "de";

/** 伪翻译：每条文案加上 `[<locale>] ` 前缀。serve.ts 生成 messages 时和用例断言时共用。 */
export function pseudoTranslate<T>(value: T): T {
  if (typeof value === "string") return `[${TEST_LOCALE}] ${value}` as T;
  return Object.fromEntries(
    Object.entries(value as object).map(([k, v]) => [k, pseudoTranslate(v)]),
  ) as T;
}

/** 多语言副本所在目录（按端口区分，便于并行）。 */
export function i18nCopyDir(port: number | string) {
  return path.join(os.tmpdir(), `sass-e2e-i18n-${port}`);
}
