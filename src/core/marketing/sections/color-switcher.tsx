"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/core/lib/utils";
import { brandCss } from "@/core/theme/brand-css";

const PRESETS = [
  "#0f766e",
  "#4f46e5",
  "#b45309",
  "#166534",
  "#334155",
  "#be185d",
];

/** Use the same light/dark token generator as the server; never pin dark tokens inline. */
export function ColorSwitcher({
  current,
  label,
  prompt,
  switchToLabel,
}: {
  current: string;
  label: string;
  prompt: string;
  switchToLabel: string;
}) {
  const [active, setActive] = useState(current);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const colors = PRESETS.includes(current) ? PRESETS : [current, ...PRESETS];
  useEffect(() => {
    if (active === current) return;
    const style = document.createElement("style");
    style.dataset.brandPreview = "true";
    style.textContent = brandCss({ primaryColor: active });
    document.head.appendChild(style);
    return () => style.remove();
  }, [active, current]);
  return (
    <div
      className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1"
      role="radiogroup"
      aria-label={label}
    >
      <span className="text-muted-foreground text-xs">{prompt}</span>
      <div className="flex flex-wrap gap-0.5">
        {colors.map((hex, index) => (
          <button
            key={hex}
            ref={(el) => {
              buttons.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active === hex}
            aria-label={switchToLabel.replace("__HEX__", hex)}
            tabIndex={active === hex ? 0 : -1}
            onClick={() => setActive(hex)}
            onKeyDown={(e) => {
              let next: number | undefined;
              if (e.key === "ArrowRight" || e.key === "ArrowDown")
                next = (index + 1) % colors.length;
              if (e.key === "ArrowLeft" || e.key === "ArrowUp")
                next = (index - 1 + colors.length) % colors.length;
              if (e.key === "Home") next = 0;
              if (e.key === "End") next = colors.length - 1;
              if (next === undefined) return;
              e.preventDefault();
              setActive(colors[next]!);
              buttons.current[next]?.focus();
            }}
            className="focus-visible:outline-ring flex size-10 items-center justify-center rounded-full focus-visible:outline-2"
          >
            <span
              aria-hidden
              className={cn(
                "size-6 rounded-full border-2 transition-transform motion-reduce:transition-none",
                active === hex
                  ? "border-background ring-foreground/50 ring-2"
                  : "border-transparent hover:scale-110",
              )}
              style={{ backgroundColor: hex }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
