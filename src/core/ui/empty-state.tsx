import * as React from "react";
import { cn } from "cn";

/**
 * 图标片：粉彩底 + 1px 语义描边，零唇边。尺寸由这里定，传进来的图标不要再写
 * `size-*` —— 下面的 `[&_svg]:size-*` 是后代选择器，特异性更高，会把它盖掉。
 * 颜色可以写在图标上（`className="text-destructive"`），显式 class 会盖过继承。
 *
 * `tone`：空状态用品牌的暖色片，等待/失败这类状态用中性片，让图标本身去承载语义。
 */
function EmptyStateIcon({
  size = "default",
  tone = "brand",
  children,
}: {
  size?: "default" | "sm";
  tone?: "brand" | "neutral";
  children: React.ReactNode;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl border",
        size === "sm" ? "size-10 [&_svg]:size-5" : "size-12 [&_svg]:size-6",
        tone === "brand"
          ? "bg-primary-band text-primary-text border-[var(--primary-edge)]"
          : "bg-muted text-muted-foreground border-border",
      )}
    >
      {children}
    </span>
  );
}

/**
 * 空状态/状态页的固定形状：居中图标片 + 粗标题 + 弱描述 + 一个主操作。
 *
 * 图标片是平面：1px 语义描边、零唇边，和 `.panel` 同属产品语域。
 *
 * 两条别踩：
 * - **不要给它加 `role="status"`**。dashboard 的 e2e 用无作用域的
 *   `getByRole("status")` 断言保存提示，页面上多一个 status 就会撞车。
 * - **标题的标签由调用方用 `titleAs` 指定**，因为同一个形状在三个位置分别是
 *   页面的 h1（checkout 状态页）、区块的 h2（dashboard 空状态）和表格单元格里的
 *   一行文字（`EmptyRow`，那里不该多出一个标题）。
 */
function EmptyState({
  icon,
  title,
  titleAs: Title = "p",
  description,
  size = "default",
  className,
  children,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  titleAs?: "h1" | "h2" | "h3" | "p";
  description?: React.ReactNode;
  size?: "default" | "sm";
  className?: string;
  /** 主操作，一屏一个实心的。 */
  children?: React.ReactNode;
}) {
  const compact = size === "sm";
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center",
        compact ? "gap-3 py-10" : "gap-4 py-14",
        className,
      )}
    >
      {icon && <EmptyStateIcon size={size}>{icon}</EmptyStateIcon>}
      <div className="max-w-md space-y-1.5">
        <Title
          className={cn("heading-display", compact ? "text-base" : "text-lg")}
        >
          {title}
        </Title>
        {description && (
          <p className="text-muted-foreground text-sm text-pretty">
            {description}
          </p>
        )}
      </div>
      {children && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {children}
        </div>
      )}
    </div>
  );
}

export { EmptyState, EmptyStateIcon };
