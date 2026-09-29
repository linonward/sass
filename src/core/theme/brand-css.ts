import type { SiteConfig } from "@/core/config/schema";

// Derives the entire palette from the single primaryColor in site.config.ts.
//
// Why compute it in TS instead of CSS `oklch(from var(--primary) calc(l - 0.22) c h)`: the
// browser's automatic gamut mapping is not the binary-search chroma narrowing we do here, so a
// contrast ratio verified in TS would not equal the contrast actually rendered in production. And
// `oklch(from ...)` invalidates the whole declaration in browsers that don't support it, with no
// fallback path. Computing it here makes the result unit-testable and lets us assert WCAG.

// Derivation constants. The edge is a relative offset ("one step darker than the fill"), not an
// absolute lightness — an absolute value would give dark brand colors an edge lighter than the
// fill, inverting the sticker's sense of depth.
const EDGE_LIGHTNESS_DROP = 0.22;
const EDGE_MIN_LIGHTNESS = 0.19;
const TEXT_LIGHTNESS = 0.5;
const TEXT_MAX_CHROMA = 0.16;
const BAND_LIGHTNESS = 0.93;
const BAND_MAX_CHROMA = 0.05;
const EDGE_MAX_CHROMA = 0.17;

/** Chroma that tints neutrals toward the brand hue: almost imperceptible, but it creates subconscious harmony. */
const NEUTRAL_CHROMA = 0.006;

/** Lightness of the light-theme canvas; ensureContrast measures contrast against it. */
const CANVAS_LIGHTNESS = 0.969;
/** Minimum contrast for UI boundaries (outlines). */
const MIN_EDGE_CONTRAST = 3;
/** Minimum contrast for body text, WCAG AA. */
const MIN_TEXT_CONTRAST = 4.5;

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

const toLinear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const toGamma = (value: number) => {
  const c =
    value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
};

export type Oklch = { L: number; C: number; H: number };

/** sRGB hex → linear RGB triple. No `.map`: that would widen the tuple to number[] and lose its length. */
function linearRgb(hex: string): [number, number, number] {
  const [r, g, b] = toRgb(hex);
  return [toLinear(r), toLinear(g), toLinear(b)];
}

/** sRGB hex → OKLCH. */
export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = linearRgb(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const H = (Math.atan2(B, A) * 180) / Math.PI;
  return { L, C: Math.hypot(A, B), H: H < 0 ? H + 360 : H };
}

const OKLCH_TO_LINEAR = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.707614701],
] as const;

/** OKLCH → linear sRGB channels; may fall outside [0,1] (used for gamut checks). */
function oklchToLinear({ L, C, H }: Oklch): [number, number, number] {
  const h = (H * Math.PI) / 180;
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return OKLCH_TO_LINEAR.map(([p, q, r]) => p * l + q * m + r * s) as [
    number,
    number,
    number,
  ];
}

const inGamut = (color: Oklch) =>
  oklchToLinear(color).every((v) => v >= -0.001 && v <= 1.001);

/** OKLCH → hex. Out-of-gamut values are clamped to the boundary. */
export function oklchToHex(color: Oklch): string {
  return (
    "#" +
    oklchToLinear(color)
      .map((v) => toGamma(v).toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * Narrows chroma into the sRGB gamut (binary search).
 * Without this, `oklchToHex` silently clamps to the boundary and the derived edge/text drift away
 * from the intended hue.
 */
export function fitChroma(L: number, C: number, H: number): number {
  let low = 0;
  let high = C;
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    if (inGamut({ L, C: mid, H })) low = mid;
    else high = mid;
  }
  return low;
}

/** Relative luminance, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const [r, g, b] = linearRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Darkens a color until it reaches the minimum contrast against the background.
 *
 * Why not clamp with "lightness must not exceed some magic number": OKLCH's L is perceptual
 * lightness while WCAG contrast is computed from relative luminance, and the two are not
 * proportional across hues — a gray at L=0.6 and a saturated blue at L=0.6 have very different
 * actual contrast. So we measure contrast directly and lower L as needed; the rule proves itself.
 * Near-white / near-gray brand colors (chroma≈0) rely on this step alone to push the edge dark
 * enough to be visible.
 */
function ensureContrast(hex: string, background: string, min: number): string {
  const tone = hexToOklch(hex);
  const { C, H } = tone;
  let { L } = tone;
  let out = hex;
  for (let i = 0; i < 60 && contrastRatio(out, background) < min; i += 1) {
    L = Math.max(0, L - 0.015);
    out = oklchToHex({ L, C: fitChroma(L, C, H), H });
  }
  return out;
}

/** Warm ink, the text color in the light theme; deliberately not pure black. */
export const INK = oklchToHex({ L: 0.202, C: 0.006, H: 60 });
/** Warm white, the text color in the dark theme; deliberately not pure white. */
export const PAPER = oklchToHex({ L: 0.985, C: 0.004, H: 60 });

/**
 * Neutral scale for the light theme (canvas / card / text / outline). The hue follows the brand at
 * a chroma of only 0.006 — barely visible, but when the buyer changes the brand color the whole
 * page quietly shifts into harmony with it.
 *
 * Exported separately because **emails and OG images cannot read CSS variables**; they have to
 * inline hex values into the HTML / share image. They must use the same values as tokens like
 * `--background` / `--border`: if each hard-coded its own cool gray, then after the buyer changes
 * the brand color the site would use tinted neutrals while emails and share images stayed on a
 * different gray.
 */
export function neutralScale(primaryColor: string) {
  const { H } = hexToOklch(primaryColor);
  const neutral = (L: number, chroma = NEUTRAL_CHROMA) =>
    oklchToHex({ L, C: fitChroma(L, chroma, H), H });

  return {
    /** Canvas → `--background` */
    canvas: neutral(CANVAS_LIGHTNESS),
    /** Light band → `--band-tint` */
    bandTint: neutral(0.921, 0.012),
    /** Card surface → `--card` / `--sidebar` */
    card: neutral(0.983, 0.005),
    /** Popovers and inputs → `--popover` / `--input` */
    popover: neutral(0.995, 0.003),
    /** Neutral fill → `--muted` / `--secondary` / `--accent` / `--sidebar-accent` */
    muted: neutral(0.945, 0.007),
    /** Secondary text → `--muted-foreground` */
    mutedForeground: neutral(0.52, 0.008),
    /** 1px outline → `--border` / `--sidebar-border` */
    border: neutral(0.885, 0.008),
  };
}

/**
 * The text color with the higher contrast on the brand color.
 *
 * This measures actual contrast rather than using a luminance threshold: INK / PAPER are not pure
 * black and white, so a threshold could pick wrong near the cutoff. Measuring both and taking the
 * higher one guarantees the best result available.
 *
 * Note the inherent limit: mid-luminance grays (relative luminance about 0.18 to 0.30) cannot reach
 * 4.5:1 with either dark or light text — that is a mathematical property, not a bug. When a buyer
 * picks such a brand color, `--primary` is still emitted exactly as configured; we can only offer
 * the best option available.
 */
export function foregroundFor(hex: string): string {
  return contrastRatio(INK, hex) >= contrastRatio(PAPER, hex) ? INK : PAPER;
}

/**
 * Derives three semantic tones from the brand color, plus a light tint for full-width bands.
 *
 * Every semantic role has three tones — fill / edge / text:
 * edge serves as both the 1px outline and the zero-blur hard shadow ("one color used twice" is
 * where the sticker look comes from); text is the same hue pushed dark enough to read as text on a
 * light background.
 */
export function deriveBrand(primaryColor: string) {
  const { L, C, H } = hexToOklch(primaryColor);

  const at = (lightness: number, maxChroma: number) => {
    const l = Math.max(0, Math.min(1, lightness));
    return oklchToHex({ L: l, C: fitChroma(l, Math.min(C, maxChroma), H), H });
  };

  // Light canvas reference for derivation; the same value brandCss emits (single source).
  const { canvas } = neutralScale(primaryColor);

  const edgeLightness = Math.max(L - EDGE_LIGHTNESS_DROP, EDGE_MIN_LIGHTNESS);

  return {
    canvas,
    fill: primaryColor,
    /** One step darker than the fill, for outlines and hard shadows. */
    edge: ensureContrast(
      at(edgeLightness, EDGE_MAX_CHROMA),
      canvas,
      MIN_EDGE_CONTRAST,
    ),
    /** Pushed to a tone readable on light backgrounds, for text and icons. */
    text: ensureContrast(
      at(Math.min(L, TEXT_LIGHTNESS), TEXT_MAX_CHROMA),
      canvas,
      MIN_TEXT_CONTRAST,
    ),
    /** Heavily lightened tint, for full-width band backgrounds. */
    band: at(BAND_LIGHTNESS, BAND_MAX_CHROMA),
    /** Dark tone for full-width bands in the dark theme. */
    bandDark: at(0.26, BAND_MAX_CHROMA),
    foreground: foregroundFor(primaryColor),
  };
}

function declare(pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .map(([name, value]) => `${name}:${value};`)
    .join("");
}

/**
 * Generates the CSS that overrides the theme variables from `brand`.
 *
 * Three rules, not one:
 * - The brand anchors are shared by both themes and stay exactly as before (`brand-css.test.ts`
 *   asserts this literal).
 * - Light uses `html:root`, dark uses `html:root.dark`.
 *   It can't be `html.dark`: that ties with `html:root` on specificity (both 0,1,1), so source order
 *   decides the winner. That was harmless while light and dark had the same values; once the two
 *   sets diverge, the tie becomes load-bearing.
 *
 * The block must **not** be wrapped in `@layer`: `:root` / `.dark` in globals.css are unlayered, and
 * layered rules lose to them even with higher specificity.
 */
export function brandCss(brand: SiteConfig["brand"]): string {
  const primary = brand.primaryColor;
  const d = deriveBrand(primary);
  const n = neutralScale(primary);
  const { H } = hexToOklch(primary);

  // The dark neutral scale uses a different set of L values and is only needed in CSS; emails and
  // OG images always use the light version.
  const neutral = (L: number, chroma = NEUTRAL_CHROMA) =>
    oklchToHex({ L, C: fitChroma(L, chroma, H), H });

  const light = {
    "--primary": d.fill,
    "--primary-foreground": d.foreground,
    "--primary-edge": d.edge,
    "--primary-text": d.text,
    "--primary-band": d.band,
    "--ring": d.fill,
    "--sidebar-primary": d.fill,
    "--sidebar-primary-foreground": d.foreground,

    "--background": n.canvas,
    /* Dedicated background for light bands. One step darker than --muted: if the two are too
       close, the wave on the "canvas → light band" transition is invisible and the page's rhythm
       of horizontal bands falls apart. */
    "--band-tint": n.bandTint,
    "--foreground": INK,
    "--card": n.card,
    "--card-foreground": INK,
    "--popover": n.popover,
    "--popover-foreground": INK,
    "--muted": n.muted,
    "--muted-foreground": n.mutedForeground,
    "--border": n.border,
    "--input": n.popover,
    "--secondary": n.muted,
    "--secondary-foreground": INK,
    "--accent": n.muted,
    "--accent-foreground": INK,
    "--sidebar": n.card,
    "--sidebar-foreground": INK,
    "--sidebar-accent": n.muted,
    "--sidebar-accent-foreground": INK,
    "--sidebar-border": n.border,
    "--sidebar-ring": d.fill,
  };

  const dark = {
    "--primary": d.fill,
    "--primary-foreground": d.foreground,
    "--primary-edge": d.edge,
    "--primary-text": d.band,
    "--primary-band": d.bandDark,
    "--ring": d.fill,
    "--sidebar-primary": d.fill,
    "--sidebar-primary-foreground": d.foreground,

    "--background": neutral(0.2),
    "--band-tint": neutral(0.262, 0.012),
    "--foreground": PAPER,
    "--card": neutral(0.24, 0.005),
    "--card-foreground": PAPER,
    "--popover": neutral(0.26, 0.005),
    "--popover-foreground": PAPER,
    "--muted": neutral(0.28, 0.007),
    "--muted-foreground": neutral(0.72, 0.008),
    "--border": neutral(0.33, 0.008),
    "--input": neutral(0.3, 0.007),
    "--secondary": neutral(0.28, 0.007),
    "--secondary-foreground": PAPER,
    "--accent": neutral(0.28, 0.007),
    "--accent-foreground": PAPER,
    "--sidebar": neutral(0.24, 0.005),
    "--sidebar-foreground": PAPER,
    "--sidebar-accent": neutral(0.28, 0.007),
    "--sidebar-accent-foreground": PAPER,
    "--sidebar-border": neutral(0.33, 0.008),
    "--sidebar-ring": d.fill,
  };

  return [
    // --chart-1 follows the brand: the first chart color is the brand color itself; the other four
    // are fixed semantic colors.
    `html:root,html.dark{--primary:${primary};--primary-foreground:${d.foreground};--ring:${primary};--chart-1:${primary};--sidebar-primary:${primary};--sidebar-primary-foreground:${d.foreground};}`,
    `html:root{${declare(light)}}`,
    `html:root.dark{${declare(dark)}}`,
  ].join("");
}
