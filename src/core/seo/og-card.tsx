import { ImageResponse } from "next/og";

import { foregroundFor } from "@/core/theme/brand-css";

import siteConfig from "../../../site.config";
import { ogImageSize } from "./og-image-size";

export type OgCardProps = {
  /** Small text above the title, e.g. "Acme · Blog". */
  eyebrow?: string;
  title: string;
  description?: string;
  /** Small text at the bottom; defaults to the site domain. */
  footer?: string;
};

/** Share image on a brand-color background (1200×630): shared by the site default image and blog post images. */
export function ogCard({
  eyebrow,
  title,
  description,
  footer = siteConfig.domain,
}: OgCardProps) {
  // next/og doesn't support oklch, so hex has to be inlined; but the color choice is the same
  // decision and the same values as `--primary-foreground` (warm ink / warm white), so text on the
  // brand color is consistent across the whole site.
  const color = foregroundFor(siteConfig.brand.primaryColor);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: 96,
        background: siteConfig.brand.primaryColor,
        color,
      }}
    >
      {eyebrow && (
        <div style={{ fontSize: 32, marginBottom: 24, opacity: 0.8 }}>
          {eyebrow}
        </div>
      )}
      <div
        style={{
          fontSize: title.length > 40 ? 72 : 96,
          fontWeight: 700,
          letterSpacing: -2,
          lineHeight: 1.1,
        }}
      >
        {title}
      </div>
      {description && (
        <div style={{ fontSize: 40, marginTop: 24, opacity: 0.85 }}>
          {description}
        </div>
      )}
      <div style={{ fontSize: 28, marginTop: "auto", opacity: 0.7 }}>
        {footer}
      </div>
    </div>,
    ogImageSize,
  );
}
