/**
 * The locale list. **This module imports nothing, deliberately — don't read the config in here.**
 *
 * Why it isn't in `site.config.ts`: `site.config.ts` runs zod validation through `defineConfig()`
 * (`src/core/config/schema.ts`), and `src/core/i18n/routing.ts` is referenced indirectly by client
 * components (client component → `core/i18n/navigation.ts` → `routing.ts`). As soon as
 * `routing.ts` reads `site.config.ts`, **all of zod and the config schema get dragged into every
 * page's client bundle** (measured at 92 KB gzip, hitting 23 of 25 routes). So the locale list
 * lives here on its own: it's plain data, edge-safe (`src/proxy.ts`, an edge middleware, imports it
 * too), and can't drag anything in.
 *
 * Change locales here. `site.config.ts` reads from here and passes it to schema validation, so this
 * stays the single source of truth.
 */
export const locales = ["en", "zh"];

/** Default locale; must appear in `locales` above (the schema validates this). */
export const defaultLocale = "en";

/**
 * Open Graph's `og:locale` must be written as `language_TERRITORY` (e.g. `en_US`); bare language
 * codes aren't accepted. Add an entry here when adding a locale; unlisted locales are emitted as-is.
 */
export const openGraphLocales: Record<string, string> = {
  en: "en_US",
  zh: "zh_CN",
};
