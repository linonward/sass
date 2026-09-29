import { cn } from "@/core/lib/utils";

import siteConfig from "../../../site.config";

/**
 * Geometry of the built-in mark. Shared by the inline mark in the header and the favicon
 * (`src/app/icon.tsx` builds an SVG string from the same values): write them separately and a
 * change to one makes the tab icon and the header mark drift apart.
 */
export const brandMarkGeometry = {
  viewBox: "0 0 24 24",
  /** Corner radius of the rounded square background. */
  cornerRadius: 6,
  /** A centered "Λ" shape. */
  chevron: "M7 16.5 12 7l5 9.5",
  strokeWidth: 2,
} as const;

/**
 * Site mark. If `brand.logo` is set in `site.config.ts`, that image is used; otherwise the
 * built-in **inline** mark.
 *
 * Why the built-in one must be inline: an SVG inside `<img src="…svg">` is a separate document, so
 * `currentColor` can't resolve the page's color — a buyer who changes `brand.primaryColor` would
 * still get the stock indigo logo and have to edit the SVG file by hand. The inline SVG uses
 * `text-primary` (the configured primary color), so the logo follows when the brand color
 * changes.
 *
 * `Organization.logo` in structured data needs a real image URL and can't use the inline mark;
 * it always points to `DEFAULT_LOGO_PATH` (see src/core/seo/json-ld.tsx and blog/json-ld.ts).
 */
export function BrandMark({ className }: { className?: string }) {
  if (siteConfig.brand.logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- the logo may be an SVG of any format; no optimization needed
      <img src={siteConfig.brand.logo} alt="" className={className} />
    );
  }

  return (
    <svg
      viewBox={brandMarkGeometry.viewBox}
      aria-hidden
      className={cn("text-primary", className)}
    >
      <rect
        width="24"
        height="24"
        rx={brandMarkGeometry.cornerRadius}
        fill="currentColor"
      />
      {/* The glyph uses --primary-foreground: it is derived from the primary color's contrast,
          dark on light brand colors and light on dark ones, so it is always legible. */}
      <path
        d={brandMarkGeometry.chevron}
        fill="none"
        stroke="var(--primary-foreground)"
        strokeWidth={brandMarkGeometry.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
