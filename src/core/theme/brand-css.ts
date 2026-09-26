import type { SiteConfig } from "@/core/config/schema";

// 由 site.config.ts 里的一个 primaryColor 推导出整套配色。
//
// 为什么在 TS 里算，而不是用 CSS 的 `oklch(from var(--primary) calc(l - 0.22) c h)`：
// 浏览器的自动色域映射不是我们对 chroma 做的二分收窄，TS 里验证过的对比度就不等于
// 线上实际渲出来的对比度；而且 `oklch(from ...)` 在不支持的浏览器上整条声明失效，
// 没有降级路径。算在这里，结果可单测、可断言 WCAG。

/** 亮度高于此值时，品牌色上该用深色文字。0.179 是黑字白字对比度相等的分界点。 */
const DARK_TEXT_THRESHOLD = 0.179;

// 推导常量。edge 是「比填充色更深一档」的相对位移，不是绝对亮度 ——
// 绝对亮度会让深色品牌推导出比填充还浅的 edge，贴纸的立体感就反了。
const EDGE_LIGHTNESS_DROP = 0.22;
const EDGE_MIN_LIGHTNESS = 0.19;
const TEXT_LIGHTNESS = 0.5;
const TEXT_MAX_CHROMA = 0.16;
const BAND_LIGHTNESS = 0.93;
const BAND_MAX_CHROMA = 0.05;
const EDGE_MAX_CHROMA = 0.17;

/** 中性色朝品牌色相微调的 chroma，小到几乎不可感知，但能营造潜意识的协调。 */
const NEUTRAL_CHROMA = 0.006;

/** 浅色主题画布的亮度，ensureContrast 拿它对对比度。 */
const CANVAS_LIGHTNESS = 0.969;
/** UI 边界（描边）的最低对比度。 */
const MIN_EDGE_CONTRAST = 3;
/** 正文文字的最低对比度，WCAG AA。 */
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

/** sRGB hex → 线性 RGB 三元组。不用 `.map`：那会把元组摊成 number[]，丢了长度信息。 */
function linearRgb(hex: string): [number, number, number] {
  const [r, g, b] = toRgb(hex);
  return [toLinear(r), toLinear(g), toLinear(b)];
}

/** sRGB hex → OKLCH。 */
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

/** OKLCH → 线性 sRGB 三通道，可能超出 [0,1]（用于色域判断）。 */
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

/** OKLCH → hex。超出色域时钳制到边界。 */
export function oklchToHex(color: Oklch): string {
  return (
    "#" +
    oklchToLinear(color)
      .map((v) => toGamma(v).toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * 把 chroma 收窄到 sRGB 色域内（二分）。
 * 不收窄的话 `oklchToHex` 会静默钳制到边界，推导出的 edge/text 会跟预期的色相偏掉。
 */
function fitChroma(L: number, C: number, H: number): number {
  let low = 0;
  let high = C;
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    if (inGamut({ L, C: mid, H })) low = mid;
    else high = mid;
  }
  return low;
}

/** 相对亮度，0（黑）到 1（白）。 */
function luminance(hex: string): number {
  const [r, g, b] = linearRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 对比度，1 到 21。 */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 压暗一个颜色直到它对背景达到最低对比度。
 *
 * 为什么不用「亮度不超过某个魔数」来钳制：OKLCH 的 L 是感知亮度，WCAG 对比度按
 * 相对亮度算，两者在色相之间不成比例 —— 同样 L=0.6 的灰和同样 L=0.6 的饱和蓝，
 * 实际对比度差很多。所以这里直接量对比度、按需压 L，规则自证。
 * 近白/近灰的品牌色（chroma≈0）只能靠这一档把 edge 压到能看见。
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

/** 暖墨，亮色主题下的文字色；刻意不用纯黑。 */
export const INK = oklchToHex({ L: 0.202, C: 0.006, H: 60 });
/** 暖白，深色主题下的文字色；刻意不用纯白。 */
export const PAPER = oklchToHex({ L: 0.985, C: 0.004, H: 60 });

/** 品牌色上是否应该用深色文字。 */
export function needsDarkText(hex: string): boolean {
  return luminance(hex) > DARK_TEXT_THRESHOLD;
}

/**
 * 在品牌色上对比度更高的文字颜色。
 *
 * 这里量的是实际对比度，不是拿亮度阈值卡：INK / PAPER 不是纯黑纯白，阈值那一点
 * 附近可能选错。量一把两种，选高的，保证拿到当下能达到的最优解。
 *
 * 注意固有极限：中等亮度的灰（相对亮度约 0.18 到 0.30）跟深色和浅色文字都够不到
 * 4.5:1，这是数学性质不是 bug。买家挑到那种品牌色时，`--primary` 仍按配置原样输出，
 * 我们只能给到当下最好的那个。
 */
export function foregroundFor(hex: string): string {
  return contrastRatio(INK, hex) >= contrastRatio(PAPER, hex) ? INK : PAPER;
}

/**
 * 由品牌色推导三档语义色，加一档给整块色带用的浅色。
 *
 * 每个语义角色都是 fill / edge / text 三档：
 * edge 同时做 1px 描边和零模糊硬阴影（「一个色用两次」是贴纸质感的来源），
 * text 是同一色相压到能在浅底上当文字用的那一档。
 */
export function deriveBrand(primaryColor: string) {
  const { L, C, H } = hexToOklch(primaryColor);

  const at = (lightness: number, maxChroma: number) => {
    const l = Math.max(0, Math.min(1, lightness));
    return oklchToHex({ L: l, C: fitChroma(l, Math.min(C, maxChroma), H), H });
  };

  // 推导时的浅色画布参照，和 brandCss 里生成的是同一个值。
  const canvas = oklchToHex({
    L: CANVAS_LIGHTNESS,
    C: fitChroma(CANVAS_LIGHTNESS, NEUTRAL_CHROMA, H),
    H,
  });

  const edgeLightness = Math.max(L - EDGE_LIGHTNESS_DROP, EDGE_MIN_LIGHTNESS);

  return {
    canvas,
    fill: primaryColor,
    /** 比填充深一档，用于描边和硬阴影。 */
    edge: ensureContrast(
      at(edgeLightness, EDGE_MAX_CHROMA),
      canvas,
      MIN_EDGE_CONTRAST,
    ),
    /** 压到能在浅底上读的档位，用于文字和图标。 */
    text: ensureContrast(
      at(Math.min(L, TEXT_LIGHTNESS), TEXT_MAX_CHROMA),
      canvas,
      MIN_TEXT_CONTRAST,
    ),
    /** 大幅提亮的浅色，用于整块色带背景。 */
    band: at(BAND_LIGHTNESS, BAND_MAX_CHROMA),
    /** 深色主题下整块色带用的暗色。 */
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
 * 由 `brand` 生成覆盖主题变量的 CSS。
 *
 * 三条规则，不是一条：
 * - 品牌锚点两条主题共用，保持和之前完全一致（`brand-css.test.ts` 断言了这个字面量）。
 * - 亮色用 `html:root`，暗色用 `html:root.dark`。
 *   不能写 `html.dark`：它和 `html:root` 特异性打平（都是 0,1,1），靠源码顺序决定胜负。
 *   以前亮暗同值所以无害，一旦两套值分化，这个平局就变成承重结构。
 *
 * 整块**不能**包 `@layer`：globals.css 里的 `:root` / `.dark` 是 unlayered 的，
 * layered 的规则即使特异性更高也会输。
 */
export function brandCss(brand: SiteConfig["brand"]): string {
  const primary = brand.primaryColor;
  const d = deriveBrand(primary);
  const { H } = hexToOklch(primary);

  // 中性色朝品牌色相微调。所有 L 值固定，只让色相跟着品牌走。
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

    "--background": d.canvas,
    /* 浅色带的专用底色。比 --muted 再深一档：两者差太近的话，波浪在
       「画布 → 浅色带」这一段上根本看不出来，整页的横向色带节奏就散了。 */
    "--band-tint": neutral(0.921, 0.012),
    "--foreground": INK,
    "--card": neutral(0.983, 0.005),
    "--card-foreground": INK,
    "--popover": neutral(0.995, 0.003),
    "--popover-foreground": INK,
    "--muted": neutral(0.945, 0.007),
    "--muted-foreground": neutral(0.52, 0.008),
    "--border": neutral(0.885, 0.008),
    "--input": neutral(0.995, 0.003),
    "--secondary": neutral(0.945, 0.007),
    "--secondary-foreground": INK,
    "--accent": neutral(0.945, 0.007),
    "--accent-foreground": INK,
    "--sidebar": neutral(0.983, 0.005),
    "--sidebar-foreground": INK,
    "--sidebar-accent": neutral(0.945, 0.007),
    "--sidebar-accent-foreground": INK,
    "--sidebar-border": neutral(0.885, 0.008),
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
    `html:root,html.dark{--primary:${primary};--primary-foreground:${d.foreground};--ring:${primary};--sidebar-primary:${primary};--sidebar-primary-foreground:${d.foreground};}`,
    `html:root{${declare(light)}}`,
    `html:root.dark{${declare(dark)}}`,
  ].join("");
}
