/**
 * llms.txt layout (convention at https://llmstxt.org):
 *
 *     # Site name
 *     > One sentence
 *     (body paragraphs)
 *     ## Section
 *     - [Title](url): description
 *
 * This layer only handles layout and doesn't touch config or messages — the caller assembles the
 * content (see src/app/llms.txt/route.ts), so it can be unit-tested and depends on neither
 * next-intl nor the request context.
 */

export type LlmsItem = {
  title: string;
  /** Without a url this line is plain text, for notes like "these paths require sign-in". */
  url?: string;
  note?: string;
};

export type LlmsSection = {
  title: string;
  /** A paragraph of explanation under the section heading. */
  note?: string;
  items: LlmsItem[];
};

export type LlmsDoc = {
  name: string;
  /** The blockquote under the H1: one sentence saying what the site is. */
  summary: string;
  /** Body paragraphs. */
  intro: string;
  sections: LlmsSection[];
  /** The last section is always called Optional: agents needing a shorter context can skip it entirely. Omitted when empty. */
  optional?: LlmsSection;
};

function renderItem(item: LlmsItem): string {
  if (!item.url) return `- ${item.note ?? item.title}`;
  const line = `- [${item.title}](${item.url})`;
  return item.note ? `${line}: ${item.note}` : line;
}

/** An empty section (no entries) is not rendered at all — e.g. with the blog off there shouldn't be an empty heading. */
function renderSection(section: LlmsSection | undefined): string {
  if (!section || section.items.length === 0) return "";
  return [`## ${section.title}`, section.note, ...section.items.map(renderItem)]
    .filter(Boolean)
    .join("\n");
}

export function buildLlmsTxt(doc: LlmsDoc): string {
  const blocks = [
    `# ${doc.name}`,
    `> ${doc.summary}`,
    doc.intro,
    ...[...doc.sections, doc.optional].map(renderSection).filter(Boolean),
  ];
  // End with a newline: like robots.txt / sitemap.xml, this is a file, not a stream.
  return `${blocks.join("\n\n")}\n`;
}
