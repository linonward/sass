import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { landingSchema, navSchema, type SiteConfig } from "./schema";

/**
 * Site overlay: one deployment of this codebase can show a different home page and header nav from
 * the defaults in site.config.ts and messages/, without editing either.
 *
 * Set `SITE_OVERLAY_DIR` to a directory (relative to the project root) containing any of:
 *
 * - `site.json`: `{ "landing": {…}, "nav": {…}, "blog": {…} }`. `landing` / `nav` replace that whole
 *   section of site.config.ts and are validated with the same schema. `blog: { "noIndex": true }`
 *   keeps the blog reachable but out of search results, the sitemap and llms.txt (for a deployment
 *   whose blog still holds the template's sample posts).
 * - `messages/<locale>.json`: deep-merged over `messages/<locale>.json`; keys you leave out keep the
 *   default copy.
 *
 * Unset means no overlay. A directory that is set but missing, or a file that fails validation,
 * fails loudly instead of silently falling back to the defaults.
 *
 * Server-only: reads files at request / build time.
 */

const overlaySchema = z.strictObject({
  landing: landingSchema.optional(),
  nav: navSchema.optional(),
  blog: z.strictObject({ noIndex: z.boolean() }).optional(),
});

type Overlay = z.infer<typeof overlaySchema>;
type Messages = Record<string, unknown>;
type OverlayEnv = Record<string, string | undefined>;

function overlayDir(env: OverlayEnv = process.env) {
  const dir = env.SITE_OVERLAY_DIR?.trim();
  if (!dir) return undefined;
  const resolved = path.resolve(process.cwd(), dir);
  if (!existsSync(resolved)) {
    throw new Error(
      `SITE_OVERLAY_DIR points to ${resolved}, which does not exist.`,
    );
  }
  return resolved;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Could not read site overlay file ${file}`, {
      cause: error,
    });
  }
}

let cachedOverlay: { dir: string | undefined; value: Overlay } | undefined;

export function readOverlay(env: OverlayEnv = process.env): Overlay {
  const dir = overlayDir(env);
  if (cachedOverlay && cachedOverlay.dir === dir) return cachedOverlay.value;
  const file = dir && path.join(dir, "site.json");
  let value: Overlay = {};
  if (file && existsSync(file)) {
    const parsed = overlaySchema.safeParse(readJson(file));
    if (!parsed.success) {
      throw new Error(
        `Invalid site overlay ${file}:\n${z.prettifyError(parsed.error)}`,
      );
    }
    value = parsed.data;
  }
  cachedOverlay = { dir, value };
  return value;
}

/** site.config with the overlay's `landing` / `nav` applied (unchanged when there is no overlay). */
export function withOverlay<T extends Pick<SiteConfig, "landing" | "nav">>(
  config: T,
  env: OverlayEnv = process.env,
): T {
  const overlay = readOverlay(env);
  return {
    ...config,
    ...(overlay.landing && { landing: overlay.landing }),
    ...(overlay.nav && { nav: overlay.nav }),
  };
}

/** True when the overlay asks search engines not to index the blog (see `blog` above). */
export function blogNoIndex(env: OverlayEnv = process.env): boolean {
  return readOverlay(env).blog?.noIndex === true;
}

function isPlainObject(value: unknown): value is Messages {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deepMerge(base: Messages, override: Messages): Messages {
  const merged: Messages = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    merged[key] =
      isPlainObject(current) && isPlainObject(value)
        ? deepMerge(current, value)
        : value;
  }
  return merged;
}

/** messages/<locale>.json with the overlay's copy for that locale merged on top. */
export function withOverlayMessages<T extends Messages>(
  locale: string,
  messages: T,
  env: OverlayEnv = process.env,
): T {
  const dir = overlayDir(env);
  const file = dir && path.join(dir, "messages", `${locale}.json`);
  if (!file || !existsSync(file)) return messages;
  const override = readJson(file);
  if (!isPlainObject(override)) {
    throw new Error(`Site overlay ${file} must be a JSON object.`);
  }
  return deepMerge(messages, override) as T;
}
