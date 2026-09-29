/**
 * Site-relative changelog paths (without the locale prefix).
 *
 * Lives in its own file and imports nothing: the footer hides the link based on the flag
 * (`core/layout/footer-nav.ts`), while `entries.ts` pulls in content-collections — every page that
 * renders the footer shouldn't be dragged along for that.
 */

export const changelogPath = "/changelog";

export const feedPath = `${changelogPath}/rss.xml`;

/**
 * An entry's anchor on the page (every entry on the page has `id="<slug>"`).
 * The changelog is a single page with no per-entry detail page, but every RSS item needs its own
 * address — otherwise all entries share a guid and readers treat them as one item.
 */
export const entryAnchor = (slug: string) => `${changelogPath}#${slug}`;
