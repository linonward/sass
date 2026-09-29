import os from "node:os";
import path from "node:path";

// Test locale for e2e; its messages are pseudo-translated from en.json by serve.ts.
export const TEST_LOCALE = "de";

/**
 * Pseudo-translation: prefix every message with `[<locale>] `. Shared by serve.ts when generating
 * messages and by the specs when asserting.
 */
export function pseudoTranslate<T>(value: T): T {
  if (typeof value === "string") return `[${TEST_LOCALE}] ${value}` as T;
  return Object.fromEntries(
    Object.entries(value as object).map(([k, v]) => [k, pseudoTranslate(v)]),
  ) as T;
}

/** Directory of the i18n copy (keyed by port so suites can run in parallel). */
export function i18nCopyDir(port: number | string) {
  return path.join(os.tmpdir(), `sass-e2e-i18n-${port}`);
}
