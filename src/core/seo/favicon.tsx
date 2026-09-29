import { ImageResponse } from "next/og";

import { brandMarkGeometry } from "@/core/layout/brand-mark";
import { foregroundFor } from "@/core/theme/brand-css";

import siteConfig from "../../../site.config";

/**
 * The browser tab icon. Generated once at build time by `src/app/icon.tsx` (Next's `icon` file
 * convention), the same pattern as `og-card.tsx`: the image is produced here, and the route file
 * only exports it per the convention.
 *
 * Size 96×96: a tab needs 32 / 48 physical pixels on 2x / 3x screens, so 96 is enough and stays
 * crisp; Google search results also require a favicon of at least 48px and a multiple of 48.
 */
export const faviconSize = { width: 96, height: 96 };

/**
 * SVG source of the mark, with colors derived from the brand color: the background is the
 * configured `brand.primaryColor`, and the glyph uses `foregroundFor` (the same value as
 * `--primary-foreground`). The geometry comes from `brandMarkGeometry` — the tab icon and the
 * header mark must look identical.
 *
 * Extracted so it can be tested: ImageResponse can't render in the unit-test environment (jsdom),
 * so the assertable part lives here.
 */
export function faviconSvg(): string {
  const { primaryColor } = siteConfig.brand;
  const { viewBox, cornerRadius, chevron, strokeWidth } = brandMarkGeometry;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">`,
    `<rect width="24" height="24" rx="${cornerRadius}" fill="${primaryColor}"/>`,
    `<path d="${chevron}" fill="none" stroke="${foregroundFor(primaryColor)}"`,
    ` stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`,
    `</svg>`,
  ].join("");
}

/**
 * The browser tab icon (PNG).
 *
 * Why PNG instead of SVG: Safari only supports SVG favicons from version 26; earlier versions show
 * no icon at all for `type="image/svg+xml"` — exactly the symptom this icon fixes. Every browser
 * supports PNG.
 *
 * Why draw it in code instead of shipping a static image: the colors come from `site.config.ts`,
 * whereas a static image hard-codes them, so a buyer who changes the brand color would have to edit
 * another file by hand — contradicting "change one config value to restyle the whole site".
 */
export function faviconImage(): ImageResponse {
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(faviconSvg()).toString("base64")}`;

  return new ImageResponse(
    // ImageResponse's root must be a block element with display set; the image hangs beneath it.
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- this JSX tree is rendered to PNG by satori, not an <img> on a page, so next/image doesn't apply */}
      <img
        src={dataUri}
        width={faviconSize.width}
        height={faviconSize.height}
        alt=""
      />
    </div>,
    faviconSize,
  );
}
