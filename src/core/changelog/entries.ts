import { allChangelogs, type Changelog } from "content-collections";

import siteConfig from "../../../site.config";
import type { ChangelogCategory } from "./frontmatter";

export type ChangelogEntry = Changelog;
export type { ChangelogCategory };
export { changelogPath, entryAnchor, feedPath } from "./paths";

/** Whether `changelog.enabled` is on. When off, /changelog and its feed return 404 and the footer hides the link. */
export const changelogEnabled = siteConfig.changelog.enabled;

/** Newest first; same-day entries sort by slug so output doesn't depend on build order. */
const newestFirst = (a: ChangelogEntry, b: ChangelogEntry) =>
  b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug);

/**
 * All entries, newest first. Empty when changelog is off.
 *
 * Entries are not localized: there is one copy of the content, and the page chrome follows the
 * current locale (the same tradeoff as the legal pages; see the changelog comment in
 * content-collections.ts).
 */
export function getEntries(): ChangelogEntry[] {
  if (!changelogEnabled) return [];
  return [...allChangelogs].sort(newestFirst);
}

export type ChangelogMonth = {
  /** `2026-09`, rendered on the page as a localized "September 2026". */
  month: string;
  entries: ChangelogEntry[];
};

/**
 * Groups by month. `entries` is already sorted newest first, so the Map's insertion order is months
 * newest first and each group stays newest first — neither output needs sorting again.
 */
export function groupByMonth(
  entries: readonly ChangelogEntry[],
): ChangelogMonth[] {
  const groups = new Map<string, ChangelogEntry[]>();
  for (const entry of entries) {
    const month = entry.date.slice(0, 7);
    const group = groups.get(month);
    if (group) group.push(entry);
    else groups.set(month, [entry]);
  }
  return [...groups].map(([month, entries]) => ({ month, entries }));
}
