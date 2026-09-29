import * as React from "react";
import { cn } from "cn";

/**
 * Page header for product/admin surfaces. Marketing surfaces don't use it — they use large display
 * type plus a color band.
 *
 * This file deliberately imports nothing else:
 * - No Link from `@/core/i18n/navigation`. It is a client component and would drag server pages
 *   like settings, billing and admin/* across the client boundary. The back link and the
 *   right-hand actions are passed in by the caller as ReactNode.
 * - No `"use client"` and no hooks, so it renders directly on both server and client.
 */
function PageHeader({
  title,
  description,
  className,
  children,
}: {
  title: string;
  /** Accepts a node: the dashboard's description line carries the `signed-in-as` testid used by e2e. */
  description?: React.ReactNode;
  className?: string;
  /** Right-hand action area (filters, primary action). On narrow screens flex-wrap moves it to the next line. */
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
        {/* .heading-display already sets weight 600, line-height 0.98 and negative tracking;
            don't stack font-semibold / tracking-tight on top, the two would fight. */}
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
