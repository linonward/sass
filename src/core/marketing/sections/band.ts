import type { LandingSectionId } from "@/core/config/schema";

/**
 * The page's horizontal color bands.
 *
 * Sections are separated by bands and waves, not by cards floating in whitespace. Each section's
 * band is defined centrally in the bands table below rather than scattered across components.
 */
export type Band = "canvas" | "tint" | "primary" | "success" | "dark";

/**
 * Each section's outer band; the hero flow strip and alternating feature rows use the light brand
 * tint inside their sections. Landing uses this to compute the wave between adjacent sections, so
 * this is the single source of truth.
 */
export const bands: Record<LandingSectionId, Band> = {
  hero: "canvas",
  timesaved: "tint",
  features: "canvas",
  testimonials: "primary",
  pricing: "tint",
  delivery: "canvas",
  faq: "canvas",
  cta: "primary",
};

/** Band backgrounds. Must be literals: Tailwind scans source text, and concatenated classes get dropped. */
export const bandBg: Record<Band, string> = {
  canvas: "bg-background",
  tint: "bg-band-tint",
  primary: "bg-primary-band",
  success: "bg-success-band",
  dark: "bg-footer",
};

/** Wave fill colors, one-to-one with the backgrounds above; the two must match exactly. */
export const bandFill: Record<Band, string> = {
  canvas: "fill-background",
  tint: "fill-band-tint",
  primary: "fill-primary-band",
  success: "fill-success-band",
  dark: "fill-footer",
};
