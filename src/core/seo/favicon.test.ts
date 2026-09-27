import { describe, expect, test } from "vitest";

import siteConfig from "../../../site.config";
import { foregroundFor } from "../theme/brand-css";
import { faviconSvg } from "./favicon";

describe("favicon", () => {
  test("底色用配置里的品牌色，字形用推导出的前景色", () => {
    const svg = faviconSvg();
    expect(svg).toContain(`fill="${siteConfig.brand.primaryColor}"`);
    expect(svg).toContain(
      `stroke="${foregroundFor(siteConfig.brand.primaryColor)}"`,
    );
  });

  test("是方形的 SVG，浏览器可以缩放到任意标签页尺寸", () => {
    const svg = faviconSvg();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('viewBox="0 0 24 24"');
  });
});
