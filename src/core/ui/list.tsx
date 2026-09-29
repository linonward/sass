import { ChevronLeft, ChevronRight, InboxIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type * as React from "react";

import { Link } from "@/core/i18n/navigation";
import { cn } from "@/core/lib/utils";
import { localizedPath } from "@/core/seo/urls";
import { Button, buttonVariants } from "@/core/ui/button";
import { EmptyState } from "@/core/ui/empty-state";
import { Input } from "@/core/ui/input";

/*
 * Building blocks for server-paginated lists: search, status filter, empty and
 * no-results rows, previous / next. Everything lives in the URL (shareable,
 * survives a refresh); pages read it with `parsePage` from `@/core/lib/pagination`.
 *
 * Pure UI: nothing here knows about the admin area or a specific table, so product
 * pages and business modules can use it too. `pathname` is always the unprefixed
 * path (`/invoices`); links and forms add the locale prefix themselves.
 */

type Query = Record<string, string | undefined>;

/** Keeps only query params that have a value and drops `page=1`. Every list link builds its query with this. */
export function cleanQuery(query: Query) {
  return Object.fromEntries(
    Object.entries(query).filter(
      ([key, value]) => value && !(key === "page" && value === "1"),
    ),
  ) as Record<string, string>;
}

/**
 * Search box (GET, `?q=` by default) with an optional filter slot beside it.
 *
 * Submitting drops `page`, so a new search starts on page 1. `keep` carries the
 * other active filters through the search as hidden fields.
 */
export function ListToolbar({
  pathname,
  value,
  label,
  submitLabel,
  param = "q",
  keep = {},
  children,
}: {
  pathname: string;
  /** The current search term, shown in the box. */
  value: string;
  /** Accessible name and placeholder of the search box. */
  label: string;
  submitLabel: string;
  param?: string;
  keep?: Query;
  /** Filters shown next to the search, e.g. a `StatusFilter`. */
  children?: React.ReactNode;
}) {
  const locale = useLocale();
  const hidden = Object.entries(cleanQuery(keep)).filter(
    ([key]) => key !== param && key !== "page",
  );

  return (
    <div
      data-slot="list-toolbar"
      className="flex flex-wrap items-end justify-between gap-3"
    >
      {/* Keyed on the term: a client-side navigation to the same route (clear
          filters, back / forward) doesn't remount, and an uncontrolled input would
          keep showing the old term while the table shows the new result. */}
      <form
        key={value}
        action={localizedPath(locale, pathname)}
        role="search"
        className="flex w-full max-w-md gap-2"
      >
        {hidden.map(([key, keptValue]) => (
          <input key={key} type="hidden" name={key} value={keptValue} />
        ))}
        <Input
          name={param}
          type="search"
          defaultValue={value}
          aria-label={label}
          placeholder={label}
        />
        <Button type="submit">{submitLabel}</Button>
      </form>
      {children}
    </div>
  );
}

/**
 * Status filter: a row of links, filtered on the server by `?status=`.
 *
 * With two filter groups on one page (say status and kind), give this group its
 * own `param` and pass the other group's current value in `query`: clicking here
 * keeps the other group and goes back to page 1.
 */
export function StatusFilter<T extends string>({
  pathname,
  statuses,
  current,
  label,
  param = "status",
  query = {},
  ariaLabel,
}: {
  pathname: string;
  statuses: readonly T[];
  current: T | undefined;
  label: (status: T) => string;
  param?: string;
  query?: Query;
  ariaLabel?: string;
}) {
  const t = useTranslations("Common.list");
  const options: { value: T | undefined; label: string }[] = [
    { value: undefined, label: t("all") },
    ...statuses.map((status) => ({ value: status, label: label(status) })),
  ];

  return (
    <nav
      aria-label={ariaLabel ?? t("filterLabel")}
      className="flex flex-wrap gap-1.5"
    >
      {options.map((option) => {
        const active = option.value === current;
        return (
          <Link
            key={option.value ?? "all"}
            href={{
              pathname,
              query: cleanQuery({ ...query, [param]: option.value }),
            }}
            aria-current={active ? "page" : undefined}
            className={cn(
              // Active is a neutral fill, not solid brand: solid is reserved for the
              // one primary action per screen. Inactive is ghost (clear, muted text)
              // rather than outline — in dark mode outline's `dark:bg-input/30`
              // (≈0.22) is too close to secondary (0.28) to tell which is selected.
              buttonVariants({
                variant: active ? "secondary" : "ghost",
                size: "sm",
              }),
              !active && "text-muted-foreground",
            )}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Previous / next, keeping the other query params. */
export function Pagination({
  pathname,
  query,
  page,
  totalPages,
  total,
}: {
  pathname: string;
  query: Query;
  page: number;
  totalPages: number;
  total: number;
}) {
  const t = useTranslations("Common.list");
  const link = (target: number) => ({
    pathname,
    query: cleanQuery({ ...query, page: String(target) }),
  });
  const disabled = "pointer-events-none opacity-50";

  return (
    <nav
      aria-label={t("pagination")}
      data-slot="pagination"
      className="text-muted-foreground flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <span>{t("summary", { page, totalPages, total })}</span>
      <ul className="flex gap-2">
        <li>
          <Link
            href={link(page - 1)}
            aria-disabled={page <= 1}
            tabIndex={page <= 1 ? -1 : undefined}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              page <= 1 && disabled,
            )}
          >
            <ChevronLeft />
            {t("previous")}
          </Link>
        </li>
        <li>
          <Link
            href={link(page + 1)}
            aria-disabled={page >= totalPages}
            tabIndex={page >= totalPages ? -1 : undefined}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              page >= totalPages && disabled,
            )}
          >
            {t("next")}
            <ChevronRight />
          </Link>
        </li>
      </ul>
    </nav>
  );
}

/**
 * A full-width row for an empty table. Vertical space comes from EmptyState; the
 * cell adds none.
 *
 * Pass `filtered` when a search or filter is active: the row then says nothing
 * matched (instead of "nothing here yet") and links back to the unfiltered list —
 * otherwise an empty result looks like missing data.
 */
export function EmptyRow({
  colSpan,
  text,
  icon,
  filtered,
}: {
  colSpan: number;
  text: string;
  icon?: React.ReactNode;
  filtered?: {
    /** Where "clear filters" goes: the list without any filter. */
    pathname: string;
    /** Params that aren't filters and should survive clearing (e.g. a time range). */
    keep?: Query;
    /** Overrides the default "no matches" text. */
    text?: string;
  };
}) {
  const t = useTranslations("Common.list");
  return (
    <tr>
      <td colSpan={colSpan}>
        <EmptyState
          size="sm"
          icon={icon ?? <InboxIcon />}
          title={filtered ? (filtered.text ?? t("noResults")) : text}
        >
          {filtered && (
            <Link
              href={{
                pathname: filtered.pathname,
                query: cleanQuery(filtered.keep ?? {}),
              }}
              // cn() lets the outline's border colour replace the base
              // `border-transparent`; without it there's no visible edge in light mode.
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              {t("clearFilters")}
            </Link>
          )}
        </EmptyState>
      </td>
    </tr>
  );
}
