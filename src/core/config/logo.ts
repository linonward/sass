/**
 * 出厂自带的标记文件（`public/logo.svg`）。
 *
 * 顶栏和侧边栏用的是内联的 `BrandMark`（只有内联 SVG 才跟得上品牌色），这个文件
 * 留给结构化数据：`Organization.logo` 要的是一个真实图片 URL，指向它。
 * 买家配了自己的 `brand.logo` 时，结构化数据也用买家那张图。
 */
export const DEFAULT_LOGO_PATH = "/logo.svg";
