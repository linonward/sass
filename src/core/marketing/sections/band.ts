import type { LandingSectionId } from "@/core/config/schema";

/**
 * 页面的横向色带。
 *
 * 区块靠色带和波浪分隔，不是靠留白里浮着的卡片。每个区块的色带集中定义在
 * 下面的 bands 表里，不散落到各组件内部。
 */
export type Band = "canvas" | "tint" | "primary" | "success" | "dark";

/**
 * 每个区块的外层色带；首屏流程条和特性交替行在区块内使用品牌浅色。
 * Landing 用它算相邻两段之间的波浪，所以这里是唯一的事实来源。
 */
export const bands: Record<LandingSectionId, Band> = {
  hero: "canvas",
  features: "canvas",
  pricing: "tint",
  delivery: "canvas",
  faq: "canvas",
  cta: "primary",
};

/** 色带底。必须是字面量：Tailwind 扫源码文本，拼接出来的 class 会被丢掉。 */
export const bandBg: Record<Band, string> = {
  canvas: "bg-background",
  tint: "bg-band-tint",
  primary: "bg-primary-band",
  success: "bg-success-band",
  dark: "bg-footer",
};

/** 波浪的填充色，和上面的底色一一对应，两者必须严丝合缝。 */
export const bandFill: Record<Band, string> = {
  canvas: "fill-background",
  tint: "fill-band-tint",
  primary: "fill-primary-band",
  success: "fill-success-band",
  dark: "fill-footer",
};
