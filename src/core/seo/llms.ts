/**
 * llms.txt 的排版（约定见 https://llmstxt.org）：
 *
 *     # 站点名
 *     > 一句话
 *     （正文段落）
 *     ## 小节
 *     - [标题](url): 说明
 *
 * 这一层只负责排版，不碰配置和文案 —— 内容由调用方组装（见 src/app/llms.txt/route.ts），
 * 所以它可以单测，也不依赖 next-intl 或请求上下文。
 */

export type LlmsItem = {
  title: string;
  /** 没有 url 时这一行是纯文字，用来写「这些路径要登录」这类说明。 */
  url?: string;
  note?: string;
};

export type LlmsSection = {
  title: string;
  /** 小节标题下的一段说明。 */
  note?: string;
  items: LlmsItem[];
};

export type LlmsDoc = {
  name: string;
  /** H1 下面那句 blockquote：一句话说清这个站点是什么。 */
  summary: string;
  /** 正文段落。 */
  intro: string;
  sections: LlmsSection[];
  /** 最后一节固定叫 Optional：需要更短上下文的 agent 可以整节跳过。没有内容就不出这一节。 */
  optional?: LlmsSection;
};

function renderItem(item: LlmsItem): string {
  if (!item.url) return `- ${item.note ?? item.title}`;
  const line = `- [${item.title}](${item.url})`;
  return item.note ? `${line}: ${item.note}` : line;
}

/** 空小节（没有条目）整节不渲染 —— 比如博客关掉时不该留一个空标题。 */
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
  // 末尾留一个换行，和 robots.txt / sitemap.xml 一样是「文件」不是流。
  return `${blocks.join("\n\n")}\n`;
}
