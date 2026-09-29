import { z } from "zod";

/**
 * Contract for changelog entry frontmatter: the schema, the category values, and where the
 * description comes from.
 *
 * This module imports nothing but zod — both `content-collections.ts` (the build-time schema) and
 * page code use it, and neither should drag in the other's dependencies. The schema lives here
 * rather than directly in `content-collections.ts` so frontmatter parsing can be unit-tested (see
 * changelog.test.ts).
 */

/** Entry category. It picks the badge color on the page (see entry-list.tsx) and is emitted as `<category>` in RSS. */
export const changelogCategories = ["feature", "improvement", "fix"] as const;
export type ChangelogCategory = (typeof changelogCategories)[number];

/** Frontmatter of `content/changelog/<slug>.mdx`. `content` is the MDX body, injected by content-collections. */
export const changelogFrontmatterSchema = z.object({
  title: z.string().trim().min(1),
  // Release date, e.g. 2026-01-31. The page sorts by it newest first and groups by month.
  date: z.iso.date(),
  // Category; decides the badge color on the page and is the category in both the list and RSS.
  category: z.enum(changelogCategories),
  // Summary for the list, meta description, and RSS description. Derived from the first body
  // paragraph when omitted (see summarize).
  description: z.string().trim().min(1).optional(),
  content: z.string(),
});

/** Summary length limit: enough for a list line, a meta description, and an RSS description. */
const SUMMARY_LIMIT = 200;

/** Strips inline Markdown markup, leaving readable text. */
function stripMarkdown(line: string) {
  return (
    line
      // Blockquote and list markers.
      .replace(/^[>\s]*(?:[-*+]|\d+\.)\s+/, "")
      // Links and images keep only their text.
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Emphasis and inline code markers.
      .replace(/[*_`]/g, "")
      .trim()
  );
}

/**
 * When an entry has no `description`, the first body paragraph becomes the summary: skip headings,
 * code blocks (both fences and their contents, so the summary is never a line of code), and JSX
 * lines; take the first line with content, strip Markdown markup, and truncate to `SUMMARY_LIMIT`.
 * Returns an empty string when the body has no readable text either (callers fall back to the
 * title).
 */
export function summarize(content: string): string {
  let text = "";
  let inFence = false;
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (
      inFence ||
      line === "" ||
      line.startsWith("#") ||
      line.startsWith("<")
    ) {
      continue;
    }
    text = stripMarkdown(line);
    if (text !== "") break;
  }
  if (text.length <= SUMMARY_LIMIT) return text;

  const cut = text.slice(0, SUMMARY_LIMIT);
  // Prefer breaking at a word boundary; a long word (no spaces) is cut outright.
  const at = cut.lastIndexOf(" ");
  return `${(at > SUMMARY_LIMIT / 2 ? cut.slice(0, at) : cut).trimEnd()}…`;
}
