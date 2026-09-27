import { ImageResponse } from "next/og";

import { brandMarkGeometry } from "@/core/layout/brand-mark";
import { foregroundFor } from "@/core/theme/brand-css";

import siteConfig from "../../../site.config";

/**
 * 标签页图标。构建时由 `src/app/icon.tsx`（Next 的 `icon` 文件约定）生成一次，
 * 和 `og-card.tsx` 是同一套写法：这里出图，路由文件只负责按约定导出。
 *
 * 尺寸 96×96：标签页在 2x / 3x 屏上要 32 / 48 个物理像素，96 够用且不糊；
 * Google 搜索结果的 favicon 也要求至少 48px 且是 48 的倍数。
 */
export const faviconSize = { width: 96, height: 96 };

/**
 * 标记的 SVG 源码，颜色由品牌色推导：底是配置里的 `brand.primaryColor`，
 * 字形走 `foregroundFor`（也就是 `--primary-foreground` 的同一个值）。
 * 几何取自 `brandMarkGeometry` —— 标签页图标和顶栏的标记必须长得一样。
 *
 * 单独抽出来是为了可测：ImageResponse 在单测环境（jsdom）里渲不出来，
 * 能断言的部分在这里。
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
 * 标签页图标（PNG）。
 *
 * 为什么是 PNG 而不是 SVG：Safari 到 26 才支持 SVG favicon，之前的版本遇到
 * `type="image/svg+xml"` 会干脆不显示图标 —— 那正是这个图标要修的现象。PNG 所有浏览器都认。
 *
 * 为什么用代码画而不是放一张静态图：颜色来自 `site.config.ts`，静态图里是写死的，
 * 买家换了品牌色还得再手改一个文件，和「改一个配置换整站」相矛盾。
 */
export function faviconImage(): ImageResponse {
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(faviconSvg()).toString("base64")}`;

  return new ImageResponse(
    // ImageResponse 的根节点必须是带 display 的块级元素，图挂在它下面。
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- 这棵 JSX 由 satori 渲染成 PNG，不是页面里的 <img>，套不上 next/image */}
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
