import * as React from "react";
import { cn } from "cn";

/**
 * Icon chip: pastel background + 1px semantic outline, zero lip. Size is set here; don't put
 * `size-*` on the icon you pass in — the `[&_svg]:size-*` below is a descendant selector with
 * higher specificity and will override it. Color can go on the icon
 * (`className="text-destructive"`); an explicit class beats inheritance.
 *
 * `tone`: empty states use the warm brand chip; states like pending/failed use the neutral chip,
 * letting the icon itself carry the meaning.
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
 * Fixed shape for empty states and status pages: centered icon chip + bold title + muted
 * description + one primary action.
 *
 * The icon chip is flat: 1px semantic outline, zero lip, in the same product register as
 * `.panel`.
 *
 * Two traps to avoid:
 * - **Don't add `role="status"` to it.** The dashboard e2e asserts the save notice with an
 *   unscoped `getByRole("status")`; one more status on the page and they collide.
 * - **The caller picks the title tag via `titleAs`**, because the same shape appears in three
 *   places: as the page h1 (checkout status page), a section h2 (dashboard empty state), and a
 *   line of text inside a table cell (`EmptyRow`, where an extra heading doesn't belong).
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
  /** Primary action — one solid button per screen. */
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
