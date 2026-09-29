import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (name: string) =>
  readFileSync(new URL(name, import.meta.url), "utf8");

/**
 * This file guards a specific, high-impact performance invariant, not a style preference.
 *
 * Client components reference `routing.ts` via `core/i18n/navigation.ts`, and `site.config.ts` goes
 * through `defineConfig()`'s zod validation. So as soon as `routing.ts` reads `site.config.ts`, all
 * of zod and the config schema get dragged into the client bundle of **every page** — measured at
 * 92 KB gzip, hitting 23 of 25 routes, including the three static legal pages (privacy / terms /
 * refund).
 *
 * The fix is to put the locale list in a leaf module that imports nothing (`./locales.ts`). These
 * two assertions keep it from being reverted. A regression would show up in the build output, but
 * only after a build; this turns it red at the unit-test stage.
 */
describe("i18n locale list leaf module", () => {
  it("locales.ts imports nothing (it's a leaf; any dependency could bring in zod)", () => {
    const source = read("./locales.ts");
    expect(source).not.toMatch(/^\s*import\s/m);
  });

  it("routing.ts reads from ./locales and does not import site.config", () => {
    const source = read("./routing.ts");
    // Only match real import statements: a comment mentioning site.config.ts is explaining why and
    // shouldn't count as a violation. Importing the config drags zod and the whole schema into the
    // client bundle.
    expect(source).not.toMatch(/^\s*import\s[^;]*site\.config/m);
    expect(source).toMatch(/from "\.\/locales"/);
  });
});
