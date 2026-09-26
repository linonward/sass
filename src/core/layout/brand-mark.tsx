import { cn } from "@/core/lib/utils";

import siteConfig from "../../../site.config";

/**
 * 站点标记。`site.config.ts` 里配了 `brand.logo` 就用那张图，没配就用内置的**内联**标记。
 *
 * 为什么内置的必须内联：`<img src="…svg">` 里的 SVG 是独立文档，`currentColor`
 * 解析不到页面的颜色 —— 那样买家换了 `brand.primaryColor`，logo 还是出厂那个靛蓝，
 * 只能自己去改 SVG 文件。内联的 SVG 走 `text-primary`（也就是配置的主色），
 * 换品牌色时 logo 跟着变。
 *
 * 结构化数据里的 `Organization.logo` 要的是一个真实图片 URL，用不了内联标记，
 * 那边统一指向 `DEFAULT_LOGO_PATH`（见 src/core/seo/json-ld.tsx 与 blog/json-ld.ts）。
 */
export function BrandMark({ className }: { className?: string }) {
  if (siteConfig.brand.logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- logo 可能是任意格式的 SVG，无需优化
      <img src={siteConfig.brand.logo} alt="" className={className} />
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("text-primary", className)}
    >
      <rect width="24" height="24" rx="6" fill="currentColor" />
      {/* 字形用 --primary-foreground：它是按主色对比度推出来的，浅色品牌色上是深字，
          深色品牌色上是浅字，永远看得清。 */}
      <path
        d="M7 16.5 12 7l5 9.5"
        fill="none"
        stroke="var(--primary-foreground)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
