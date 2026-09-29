import { foregroundFor, INK, neutralScale } from "@/core/theme/brand-css";

import siteConfig from "../../../site.config";

const siteUrl = `https://${siteConfig.domain}`;

const neutral = neutralScale(siteConfig.brand.primaryColor);

/**
 * Brand values used in emails. Colors are always hex (email clients support neither CSS variables
 * nor oklch), and images use absolute URLs.
 *
 * Every value comes from the light-mode tokens in `brand-css` — emails can't inline CSS variables,
 * but "which color" must be the same decision and the same values as the site: `onPrimary` is
 * `foregroundFor` (what `--primary-foreground` uses), and the neutrals are `neutralScale`
 * (`--foreground` / `--muted-foreground` / `--border` / `--background`). This used to be a
 * separate set of cool grays, so after a buyer changed the brand color the emails no longer
 * matched the site (warm ink vs. plain gray).
 */
export const emailBrand = {
  name: siteConfig.name,
  siteUrl,
  primary: siteConfig.brand.primaryColor,
  onPrimary: foregroundFor(siteConfig.brand.primaryColor),
  logoUrl: siteConfig.email.logo ? `${siteUrl}${siteConfig.email.logo}` : null,
  text: INK,
  muted: neutral.mutedForeground,
  border: neutral.border,
  background: neutral.canvas,
};
