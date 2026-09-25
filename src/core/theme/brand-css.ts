import type { SiteConfig } from "@/core/config/schema";

const DARK_TEXT = "oklch(0.145 0 0)";
const LIGHT_TEXT = "oklch(0.985 0 0)";

function toRgb(hex: string): [number, number, number] {
  const digits = hex.slice(1);
  const full =
    digits.length === 3
      ? [...digits].map((d) => d + d).join("")
      : digits.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** WCAG 相对亮度，0（黑）到 1（白）。 */
function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 在品牌色上对比度更高的文字颜色。 */
export function foregroundFor(hex: string): string {
  // 0.179 是黑字与白字对比度相等的亮度分界点。
  return luminance(hex) > 0.179 ? DARK_TEXT : LIGHT_TEXT;
}

/**
 * 由 `brand` 生成覆盖 shadcn 主题变量的 CSS，亮色和暗色共用品牌色。
 * 选择器比 globals.css 里的 `:root` / `.dark` 更具体，与样式表加载顺序无关。
 */
export function brandCss(brand: SiteConfig["brand"]): string {
  const primary = brand.primaryColor;
  const foreground = foregroundFor(primary);
  return `html:root,html.dark{--primary:${primary};--primary-foreground:${foreground};--ring:${primary};--sidebar-primary:${primary};--sidebar-primary-foreground:${foreground};}`;
}
