import * as React from "react";
import { cn } from "cn";

/**
 * 产品面/后台的页头。营销面不用它 —— 那边是 display 的大字号加色带。
 *
 * 这里刻意不 import 任何东西：
 * - 不要 `@/core/i18n/navigation` 的 Link。那是客户端组件，会把 settings、billing、
 *   admin/* 这些服务端页面一起拖进客户端边界。返回链接和右侧操作由调用方以
 *   ReactNode 传进来。
 * - 不加 `"use client"`、不用 hook，服务端和客户端两边都能直接渲染。
 */
function PageHeader({
  title,
  description,
  className,
  children,
}: {
  title: string;
  /** 允许传节点：dashboard 的描述行上挂着 `signed-in-as` 这个 e2e 用的 testid。 */
  description?: React.ReactNode;
  className?: string;
  /** 右侧操作区（筛选器、主操作）。窄屏靠 flex-wrap 换到下一行。 */
  children?: React.ReactNode;
}) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-end justify-between gap-4 border-b pb-4",
        className,
      )}
    >
      <div className="space-y-1">
        {/* .heading-display 自带字重 600、行高 0.98、负字距，不要再叠
            font-semibold / tracking-tight，两个会打架。 */}
        <h1 className="heading-display text-2xl sm:text-3xl">{title}</h1>
        {description && (
          <p className="text-muted-foreground text-sm text-pretty">
            {description}
          </p>
        )}
      </div>
      {children}
    </header>
  );
}

export { PageHeader };
