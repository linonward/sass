import { describe, expect, test } from "vitest";

import siteConfig from "../../../site.config";
import { foregroundFor } from "../theme/brand-css";
import { faviconSvg } from "./favicon";

describe("favicon", () => {
  test("background uses the configured brand color; the glyph uses the derived foreground", () => {
    const svg = faviconSvg();
    expect(svg).toContain(`fill="${siteConfig.brand.primaryColor}"`);
    expect(svg).toContain(
      `stroke="${foregroundFor(siteConfig.brand.primaryColor)}"`,
    );
  });

  test("is a square SVG the browser can scale to any tab size", () => {
    const svg = faviconSvg();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('viewBox="0 0 24 24"');
  });
});
