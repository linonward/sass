import { describe, expect, test } from "vitest";

import {
  brandCss,
  contrastRatio,
  deriveBrand,
  foregroundFor,
  hexToOklch,
  INK,
  oklchToHex,
  PAPER,
} from "./brand-css";

describe("foregroundFor", () => {
  test.each([
    ["#000000", PAPER],
    ["#4f46e5", PAPER],
    ["#ffffff", INK],
    ["#facc15", INK],
    ["#fff", INK],
  ])("%s 上使用 %s", (hex, expected) => {
    expect(foregroundFor(hex)).toBe(expected);
  });
});

describe("hexToOklch / oklchToHex", () => {
  test.each(["#4f46e5", "#facc15", "#000000", "#ffffff", "#16a34a"])(
    "%s 往返一致",
    (hex) => {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    },
  );

  test("三个字符的写法等同于六个字符", () => {
    expect(hexToOklch("#fff")).toEqual(hexToOklch("#ffffff"));
  });

  test("已知值落在预期区间", () => {
    const { L, H } = hexToOklch("#4f46e5");
    expect(L).toBeCloseTo(0.511, 2);
    expect(H).toBeCloseTo(277, 0);
  });
});

describe("contrastRatio", () => {
  test("黑白是 21:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  test("同色是 1:1", () => {
    expect(contrastRatio("#4f46e5", "#4f46e5")).toBeCloseTo(1, 5);
  });
});

// 推导的质量保证：买家填任何一个色，整套都得能读。
// 这里覆盖深色、浅色、高饱和、低饱和、极端值。
const BRAND_SAMPLES = [
  "#4f46e5",
  "#0ea5e9",
  "#16a34a",
  "#facc15",
  "#ef4444",
  "#f97316",
  "#ec4899",
  "#14b8a6",
  "#000000",
  "#ffffff",
  "#7f7f7f",
];

describe("deriveBrand", () => {
  // 中等亮度的灰是唯一够不到 AA 的输入：相对亮度约 0.18 到 0.30 之间，
  // 深色文字和浅色文字都过不了 4.5:1。这是数学性质，不是推导出错。
  const MID_TONE_UNREACHABLE = "#7f7f7f";

  test.each(BRAND_SAMPLES.filter((hex) => hex !== MID_TONE_UNREACHABLE))(
    "%s：填充上的文字过 WCAG AA",
    (hex) => {
      const d = deriveBrand(hex);
      expect(contrastRatio(d.foreground, d.fill)).toBeGreaterThanOrEqual(4.5);
    },
  );

  test("中等亮度的灰：拿不到 AA，但必须选对比度更高的那个", () => {
    const d = deriveBrand(MID_TONE_UNREACHABLE);
    const withInk = contrastRatio(INK, d.fill);
    const withPaper = contrastRatio(PAPER, d.fill);
    expect(contrastRatio(d.foreground, d.fill)).toBe(
      Math.max(withInk, withPaper),
    );
    // 记录现状：这个输入本来就无解，别让将来的改动以为这里是回归。
    expect(Math.max(withInk, withPaper)).toBeLessThan(4.5);
  });

  test.each(BRAND_SAMPLES)("%s：text 档在画布上过 AA", (hex) => {
    const d = deriveBrand(hex);
    expect(contrastRatio(d.text, d.canvas)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(BRAND_SAMPLES)("%s：edge 对画布至少 3:1", (hex) => {
    const d = deriveBrand(hex);
    // edge 要当描边用，UI 边界的最低要求是 3:1。
    expect(contrastRatio(d.edge, d.canvas)).toBeGreaterThanOrEqual(3);
  });

  test("近白品牌色也能推出一条看得见的 edge", () => {
    // chroma≈0 的极端输入只能靠压暗，这条守住 ensureContrast 不被误删。
    const d = deriveBrand("#ffffff");
    expect(contrastRatio(d.edge, d.canvas)).toBeGreaterThanOrEqual(3);
  });

  test("edge 永远比填充深，贴纸的立体感不会反", () => {
    for (const hex of BRAND_SAMPLES) {
      const { edge } = deriveBrand(hex);
      const fill = hexToOklch(hex).L;
      const edgeL = hexToOklch(edge).L;
      // 纯黑是例外：填充已经在 0，edge 只能往上走。
      if (fill > 0.2) expect(edgeL).toBeLessThan(fill);
    }
  });

  test("edge / text / band 都不超出 sRGB 色域", () => {
    for (const hex of BRAND_SAMPLES) {
      const d = deriveBrand(hex);
      for (const value of [d.edge, d.text, d.band, d.bandDark]) {
        expect(oklchToHex(hexToOklch(value))).toBe(value);
      }
    }
  });

  test("浅色品牌色会在填充上选深色文字", () => {
    expect(deriveBrand("#facc15").foreground).toBe(INK);
  });

  test("深色品牌色会在填充上选浅色文字", () => {
    expect(deriveBrand("#4f46e5").foreground).toBe(PAPER);
  });
});

describe("brandCss", () => {
  const css = brandCss({ primaryColor: "#4f46e5", logo: "/logo.svg" });

  test("亮色与暗色都覆盖 primary 相关变量", () => {
    expect(css).toContain("html:root,html.dark{");
    expect(css).toContain("--primary:#4f46e5;");
    expect(css).toContain(`--primary-foreground:${PAPER};`);
    expect(css).toContain("--ring:#4f46e5;");
    // 图表第一档跟着品牌色，不是写死的靛蓝。
    expect(css).toContain("--chart-1:#4f46e5;");
  });

  test("亮暗两套用不同特异性，不靠源码顺序决胜", () => {
    // html.dark 和 html:root 特异性打平（都是 0,1,1），必须用 html:root.dark。
    expect(css).toContain("html:root{");
    expect(css).toContain("html:root.dark{");
    expect(css).not.toMatch(/html\.dark\{--background/);
  });

  test("不包 @layer，否则会输给 globals.css 里 unlayered 的 :root", () => {
    expect(css).not.toContain("@layer");
  });

  test("推导出的三档语义色都出现在输出里", () => {
    const d = deriveBrand("#4f46e5");
    expect(css).toContain(`--primary-edge:${d.edge};`);
    expect(css).toContain(`--primary-text:${d.text};`);
    expect(css).toContain(`--primary-band:${d.band};`);
  });

  test("亮暗两套的 band 不同值", () => {
    const d = deriveBrand("#4f46e5");
    expect(css).toContain(`--primary-band:${d.band};`);
    expect(css).toContain(`--primary-band:${d.bandDark};`);
    expect(d.band).not.toBe(d.bandDark);
  });

  test("暗色主题里 primary-text 用提亮档，浅底上才有对比", () => {
    const d = deriveBrand("#4f46e5");
    const dark = css.slice(css.indexOf("html:root.dark{"));
    // 暗底上要用 band 那一档（浅），不是 text 那一档（深）。
    expect(dark).toContain(`--primary-text:${d.band};`);
  });
});
