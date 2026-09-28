"use client";

import { useCallback, useState } from "react";

import { cn } from "@/core/lib/utils";
import {
  deriveBrand,
  fitChroma,
  hexToOklch,
  neutralScale,
  oklchToHex,
  INK,
  PAPER,
} from "@/core/theme/brand-css";

const PRESETS = [
  "#0f766e", // teal (default)
  "#4f46e5", // indigo
  "#b45309", // amber
  "#166534", // forest green
  "#334155", // slate blue
  "#be185d", // rose
] as const;

const NEUTRAL_CHROMA = 0.006;

/** 暗色主题中性色阶，与 brand-css.ts brandCss() dark 段一致。 */
function darkNeutralScale(primaryColor: string) {
  const { H } = hexToOklch(primaryColor);
  const n = (L: number, chroma = NEUTRAL_CHROMA) =>
    oklchToHex({ L, C: fitChroma(L, chroma, H) as number, H });
  return {
    canvas: n(0.2),
    bandTint: n(0.262, 0.012),
    card: n(0.24, 0.005),
    popover: n(0.26, 0.005),
    muted: n(0.28, 0.007),
    mutedForeground: n(0.72, 0.008),
    border: n(0.33, 0.008),
    input: n(0.3, 0.007),
    secondary: n(0.28, 0.007),
    accent: n(0.28, 0.007),
  };
}

interface TokenSet {
  [key: string]: string;
}

function setTokens(root: HTMLElement, tokens: TokenSet) {
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(key, value);
  }
}

/** 应用整套品牌色到 <html>，覆盖服务器注入的 <style>。 */
function applyBrand(root: HTMLElement, primaryColor: string) {
  const d = deriveBrand(primaryColor);
  const light = neutralScale(primaryColor);
  const dark = darkNeutralScale(primaryColor);

  // 共享锚点（亮暗同值）
  setTokens(root, {
    "--primary": d.fill,
    "--primary-foreground": d.foreground,
    "--ring": d.fill,
    "--chart-1": d.fill,
    "--sidebar-primary": d.fill,
    "--sidebar-primary-foreground": d.foreground,
  });

  // 亮色主题
  setTokens(root, {
    "--primary-edge": d.edge,
    "--primary-text": d.text,
    "--primary-band": d.band,
    "--background": light.canvas,
    "--band-tint": light.bandTint,
    "--foreground": INK,
    "--card": light.card,
    "--card-foreground": INK,
    "--popover": light.popover,
    "--popover-foreground": INK,
    "--muted": light.muted,
    "--muted-foreground": light.mutedForeground,
    "--border": light.border,
    "--input": light.popover,
    "--secondary": light.muted,
    "--secondary-foreground": INK,
    "--accent": light.muted,
    "--accent-foreground": INK,
    "--sidebar": light.card,
    "--sidebar-foreground": INK,
    "--sidebar-accent": light.muted,
    "--sidebar-accent-foreground": INK,
    "--sidebar-border": light.border,
    "--sidebar-ring": d.fill,
  });

  // 暗色主题（只在暗色模式下显现，但 setProperty 写进 html.style 对两个模式都生效）。
  // 亮色模式下 dark 的变量会被 :root 选择器覆盖，所以原样写上不会影响亮色。
  // 暗色模式下 .dark 选择器会生效，但 inline style 优先级更高，所以必须也写上。
  setTokens(root, {
    "--primary-text": d.band,
    "--primary-band": d.bandDark,
    "--background": dark.canvas,
    "--band-tint": dark.bandTint,
    "--foreground": PAPER,
    "--card": dark.card,
    "--card-foreground": PAPER,
    "--popover": dark.popover,
    "--popover-foreground": PAPER,
    "--muted": dark.muted,
    "--muted-foreground": dark.mutedForeground,
    "--border": dark.border,
    "--input": dark.input,
    "--secondary": dark.secondary,
    "--secondary-foreground": PAPER,
    "--accent": dark.accent,
    "--accent-foreground": PAPER,
    "--sidebar": dark.card,
    "--sidebar-foreground": PAPER,
    "--sidebar-accent": dark.accent,
    "--sidebar-accent-foreground": PAPER,
    "--sidebar-border": dark.border,
    "--sidebar-ring": d.fill,
  });
}

/**
 * 一行预设色块。访客点击后整站实时换色——3 秒验证"一个 hex 换整套品牌"。
 *
 * 放在 hero 区，不抢视觉层级：小圆点、ring 指示 active、hover 放大。
 */
export function ColorSwitcher({
  current,
  label,
  prompt,
  switchToLabel,
}: {
  current: string;
  /** aria-label for the radiogroup */
  label: string;
  /** Visible hint text */
  prompt: string;
  /** aria-label template for each color button, __HEX__ is replaced */
  switchToLabel: string;
}) {
  const [active, setActive] = useState(current);
  const ariaLabel = useCallback(
    (hex: string) => switchToLabel.replace("__HEX__", hex),
    [switchToLabel],
  );
  const handleClick = useCallback((hex: string) => {
    setActive(hex);
    applyBrand(document.documentElement, hex);
  }, []);

  const size = "h-6 w-6 sm:h-7 sm:w-7";

  return (
    <div
      className="mt-5 flex items-center gap-2"
      role="radiogroup"
      aria-label={label}
    >
      <span className="text-muted-foreground mr-1 text-xs">{prompt}</span>
      {PRESETS.map((hex) => (
        <button
          key={hex}
          type="button"
          role="radio"
          aria-checked={active === hex}
          aria-label={ariaLabel(hex)}
          onClick={() => handleClick(hex)}
          className={cn(
            size,
            "rounded-full border-2 transition-all",
            "focus-visible:ring-ring hover:scale-125 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
            active === hex
              ? "border-foreground/60 ring-foreground/20 ring-2"
              : "hover:border-foreground/30 border-transparent",
          )}
          style={{ backgroundColor: hex }}
        />
      ))}
    </div>
  );
}
