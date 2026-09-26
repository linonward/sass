import type { LandingSectionId } from "@/core/config/schema";

/**
 * 页面的横向色带。
 *
 * 区块靠色带和波浪分隔，不是靠留白里浮着的卡片。每个区块的色带集中定义在
 * 下面的 bands 表里，不散落到各组件内部。
 */
export type Band = "canvas" | "tint" | "primary" | "success" | "dark";

/**
 * 每个区块用什么色带。节奏是「品牌色 → 画布 → 浅灰 → 画布 → 品牌色 → 深色页脚」，
 * 首尾两段品牌色把页面框住，中间靠明度台阶分开。
 * Landing 用它算相邻两段之间的波浪，所以这里是唯一的事实来源。
 */
export const bands: Record<LandingSectionId, Band> = {
  hero: "primary",
  features: "canvas",
  pricing: "tint",
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
