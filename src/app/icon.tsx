import { faviconImage, faviconSize } from "@/core/seo/favicon";

/**
 * 标签页图标（favicon）。放在 `src/app/` 下，Next 会按 `icon` 文件约定在构建时生成一次，
 * 并把 `<link rel="icon">` 注入 `<head>` —— 不用手写标签，浏览器标签页也不会再是空白。
 *
 * 图本身在 `src/core/seo/favicon.tsx`：颜色取自 `site.config.ts` 的 `brand.primaryColor`，
 * 几何和顶栏的内联标记共用，所以换品牌色时 favicon 跟着变，不用改任何图。
 *
 * 换成自己的图标：把一张 `icon.svg` / `icon.png` 放进 `src/app/` 并**删掉这个文件**。
 * 两个同名的 icon 文件会各生成一个 `<link rel="icon">`，浏览器挑哪个不保证。
 *
 * `/icon` 必须留在 `src/proxy.ts` 的 matcher 排除集里：注入的地址不带语言前缀，
 * 被 next-intl 改写成 `/<locale>/icon` 就会 404，标签页又变回空白。
 */
export const size = faviconSize;

export const contentType = "image/png";

export default function Icon() {
  return faviconImage();
}
