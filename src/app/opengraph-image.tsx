import { ogCard } from "@/core/seo/og-card";
import { ogImageSize } from "@/core/seo/og-image-size";

import siteConfig from "../../site.config";

export const alt = siteConfig.name;
export const size = ogImageSize;
export const contentType = "image/png";

// Default share image: brand-color background plus the site name and description. Generated at build time.
export default function OpengraphImage() {
  return ogCard({
    title: siteConfig.name,
    description: siteConfig.description,
  });
}
