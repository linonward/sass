import { cn } from "@/core/lib/utils";

import { bandFill, type Band } from "./band";

/**
 * 区块之间的波浪分隔。
 *
 * 它是独立元素而不是区块自己的装饰：背景填下一段的色，SVG 填上一段的色。
 * 这样无论 `landing.sections` 怎么配顺序，波浪永远和相邻两段对得上。
 *
 * SVG 画得比视口宽（200%）并居中，让波峰波谷的尺寸不随屏幕宽度变形；
 * 父级 overflow-hidden 负责裁掉溢出部分。用 preserveAspectRatio="none"
 * 拉伸的话，窄屏上两道波会被压得很柴。
 */
export function Wave({ from, className }: { from: Band; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("relative h-10 overflow-hidden sm:h-16", className)}
    >
      <svg
        viewBox="0 0 1920 64"
        preserveAspectRatio="none"
        className={cn("absolute -left-1/2 h-full w-[200%]", bandFill[from])}
      >
        {/* 控制点顶到 0 和 64 两端，波峰波谷各约 24px，色带交接才看得出来。
            幅度太浅的话波浪就退化成一条直线，整页的横向节奏就散了。 */}
        <path d="M0,0 H1920 V32 C1700,64 1500,64 1280,32 C1060,0 860,0 640,32 C420,64 220,64 0,32 Z" />
      </svg>
    </div>
  );
}
