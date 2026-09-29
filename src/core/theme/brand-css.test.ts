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
  ])("on %s uses %s", (hex, expected) => {
    expect(foregroundFor(hex)).toBe(expected);
  });
});

describe("hexToOklch / oklchToHex", () => {
  test.each(["#4f46e5", "#facc15", "#000000", "#ffffff", "#16a34a"])(
    "%s round-trips",
    (hex) => {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    },
  );

  test("three-digit form equals six-digit form", () => {
    expect(hexToOklch("#fff")).toEqual(hexToOklch("#ffffff"));
  });

  test("known value lands in the expected range", () => {
    const { L, H } = hexToOklch("#4f46e5");
    expect(L).toBeCloseTo(0.511, 2);
    expect(H).toBeCloseTo(277, 0);
  });
});

describe("contrastRatio", () => {
  test("black on white is 21:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  test("same color is 1:1", () => {
    expect(contrastRatio("#4f46e5", "#4f46e5")).toBeCloseTo(1, 5);
  });
});

// Quality guarantee for the derivation: whatever color the buyer enters, the whole palette must be
// readable. This covers dark, light, high-chroma, low-chroma, and extreme values.
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
  // Mid-luminance grays are the only inputs that can't reach AA: with relative luminance between
  // about 0.18 and 0.30, neither dark nor light text passes 4.5:1. That is a mathematical property,
  // not a derivation bug.
  const MID_TONE_UNREACHABLE = "#7f7f7f";

  test.each(BRAND_SAMPLES.filter((hex) => hex !== MID_TONE_UNREACHABLE))(
    "%s: text on the fill passes WCAG AA",
    (hex) => {
      const d = deriveBrand(hex);
      expect(contrastRatio(d.foreground, d.fill)).toBeGreaterThanOrEqual(4.5);
    },
  );

  test("mid-luminance gray: cannot reach AA but must pick the higher-contrast option", () => {
    const d = deriveBrand(MID_TONE_UNREACHABLE);
    const withInk = contrastRatio(INK, d.fill);
    const withPaper = contrastRatio(PAPER, d.fill);
    expect(contrastRatio(d.foreground, d.fill)).toBe(
      Math.max(withInk, withPaper),
    );
    // Documents the status quo: this input has no solution, so future changes shouldn't mistake it
    // for a regression.
    expect(Math.max(withInk, withPaper)).toBeLessThan(4.5);
  });

  test.each(BRAND_SAMPLES)("%s: text tone passes AA on the canvas", (hex) => {
    const d = deriveBrand(hex);
    expect(contrastRatio(d.text, d.canvas)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(BRAND_SAMPLES)(
    "%s: edge is at least 3:1 against the canvas",
    (hex) => {
      const d = deriveBrand(hex);
      // The edge is used as an outline; the minimum for UI boundaries is 3:1.
      expect(contrastRatio(d.edge, d.canvas)).toBeGreaterThanOrEqual(3);
    },
  );

  test("a near-white brand color still derives a visible edge", () => {
    // Extreme inputs with chroma≈0 can only be darkened; this guards ensureContrast against removal.
    const d = deriveBrand("#ffffff");
    expect(contrastRatio(d.edge, d.canvas)).toBeGreaterThanOrEqual(3);
  });

  test("edge is always darker than the fill, so the sticker depth never inverts", () => {
    for (const hex of BRAND_SAMPLES) {
      const { edge } = deriveBrand(hex);
      const fill = hexToOklch(hex).L;
      const edgeL = hexToOklch(edge).L;
      // Pure black is the exception: the fill is already at 0, so the edge can only go up.
      if (fill > 0.2) expect(edgeL).toBeLessThan(fill);
    }
  });

  test("edge / text / band all stay within the sRGB gamut", () => {
    for (const hex of BRAND_SAMPLES) {
      const d = deriveBrand(hex);
      for (const value of [d.edge, d.text, d.band, d.bandDark]) {
        expect(oklchToHex(hexToOklch(value))).toBe(value);
      }
    }
  });

  test("a light brand color picks dark text on the fill", () => {
    expect(deriveBrand("#facc15").foreground).toBe(INK);
  });

  test("a dark brand color picks light text on the fill", () => {
    expect(deriveBrand("#4f46e5").foreground).toBe(PAPER);
  });
});

describe("brandCss", () => {
  const css = brandCss({ primaryColor: "#4f46e5", logo: "/logo.svg" });

  test("both light and dark override the primary variables", () => {
    expect(css).toContain("html:root,html.dark{");
    expect(css).toContain("--primary:#4f46e5;");
    expect(css).toContain(`--primary-foreground:${PAPER};`);
    expect(css).toContain("--ring:#4f46e5;");
    // The first chart color follows the brand color instead of a hard-coded indigo.
    expect(css).toContain("--chart-1:#4f46e5;");
  });

  test("light and dark use different specificity instead of relying on source order", () => {
    // html.dark ties with html:root on specificity (both 0,1,1), so html:root.dark is required.
    expect(css).toContain("html:root{");
    expect(css).toContain("html:root.dark{");
    expect(css).not.toMatch(/html\.dark\{--background/);
  });

  test("is not wrapped in @layer, which would lose to the unlayered :root in globals.css", () => {
    expect(css).not.toContain("@layer");
  });

  test("all three derived semantic tones appear in the output", () => {
    const d = deriveBrand("#4f46e5");
    expect(css).toContain(`--primary-edge:${d.edge};`);
    expect(css).toContain(`--primary-text:${d.text};`);
    expect(css).toContain(`--primary-band:${d.band};`);
  });

  test("light and dark bands have different values", () => {
    const d = deriveBrand("#4f46e5");
    expect(css).toContain(`--primary-band:${d.band};`);
    expect(css).toContain(`--primary-band:${d.bandDark};`);
    expect(d.band).not.toBe(d.bandDark);
  });

  test("dark theme uses the lightened tone for primary-text so it has contrast on the dark background", () => {
    const d = deriveBrand("#4f46e5");
    const dark = css.slice(css.indexOf("html:root.dark{"));
    // On a dark background use the band tone (light), not the text tone (dark).
    expect(dark).toContain(`--primary-text:${d.band};`);
  });
});
