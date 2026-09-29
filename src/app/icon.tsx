import { faviconImage, faviconSize } from "@/core/seo/favicon";

/**
 * Tab icon (favicon). Because it sits in `src/app/`, Next generates it once at build time under the
 * `icon` file convention and injects `<link rel="icon">` into `<head>` — no hand-written tag, and
 * the browser tab is never blank.
 *
 * The image itself is in `src/core/seo/favicon.tsx`: its color comes from `brand.primaryColor` in
 * `site.config.ts` and its geometry is shared with the inline mark in the top bar, so changing the
 * brand color updates the favicon without editing any image.
 *
 * To use your own icon: put an `icon.svg` / `icon.png` in `src/app/` and **delete this file**. Two
 * icon files with the same name each generate a `<link rel="icon">`, and which one the browser picks
 * isn't guaranteed.
 *
 * `/icon` must stay in the matcher exclusions in `src/proxy.ts`: the injected URL has no locale
 * prefix, and if next-intl rewrites it to `/<locale>/icon` it 404s and the tab goes blank again.
 */
export const size = faviconSize;

export const contentType = "image/png";

export default function Icon() {
  return faviconImage();
}
