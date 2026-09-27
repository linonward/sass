import { z } from "zod";

/**
 * changelog 条目 frontmatter 的契约：schema 和类别取值，以及描述从哪来。
 *
 * 这个模块除了 zod 不 import 任何东西 —— `content-collections.ts`（构建期 schema）和页面代码
 * 都要用它，两边都不该把对方的依赖拖进来。schema 放在这里而不是直接写进 `content-collections.ts`，
 * 是为了能单测 frontmatter 的解析（见 changelog.test.ts）。
 */

/** 条目类别。页面上的徽章颜色按它选（见 entry-list.tsx），RSS 里输出成 `<category>`。 */
export const changelogCategories = ["feature", "improvement", "fix"] as const;
export type ChangelogCategory = (typeof changelogCategories)[number];

/** `content/changelog/<slug>.mdx` 的 frontmatter。`content` 是 MDX 正文，由 content-collections 注入。 */
export const changelogFrontmatterSchema = z.object({
  title: z.string().trim().min(1),
  // 发布日期，例如 2026-01-31。页面上按它倒序、按月分组。
  date: z.iso.date(),
  // 类别，决定页面上的徽章颜色；列表页和 RSS 的分类都用它。
  category: z.enum(changelogCategories),
  // 列表页摘要、meta description 和 RSS 描述。不填时从正文首段推导（见 summarize）。
  description: z.string().trim().min(1).optional(),
  content: z.string(),
});

/** 摘要长度上限：列表页一行、meta description 和 RSS description 都够用。 */
const SUMMARY_LIMIT = 200;

/** 去掉行内的 Markdown 标记，留下可读文本。 */
function stripMarkdown(line: string) {
  return (
    line
      // 引用和列表标记。
      .replace(/^[>\s]*(?:[-*+]|\d+\.)\s+/, "")
      // 链接和图片只留文字。
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      // 强调和行内代码的标记。
      .replace(/[*_`]/g, "")
      .trim()
  );
}

/**
 * 条目没写 `description` 时，用正文的第一段当摘要：跳过标题、代码块（围栏里外都跳过，
 * 免得摘要是一行代码）和 JSX 行，取第一行有内容的文本，去掉 Markdown 标记后截到 `SUMMARY_LIMIT`。
 * 正文也没有可读文本时返回空串（调用方兜底成标题）。
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
  // 尽量在词边界断开；长单词（没有空格）就直接截断。
  const at = cut.lastIndexOf(" ");
  return `${(at > SUMMARY_LIMIT / 2 ? cut.slice(0, at) : cut).trimEnd()}…`;
}
