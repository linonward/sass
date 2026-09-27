import { allChangelogs, type Changelog } from "content-collections";

import siteConfig from "../../../site.config";
import type { ChangelogCategory } from "./frontmatter";

export type ChangelogEntry = Changelog;
export type { ChangelogCategory };
export { changelogPath, entryAnchor, feedPath } from "./paths";

/** `changelog.enabled` 是否开启。关闭时 /changelog 和它的 feed 都返回 404、页脚不显示入口。 */
export const changelogEnabled = siteConfig.changelog.enabled;

/** 日期倒序；同一天按 slug 排，输出不随构建顺序变。 */
const newestFirst = (a: ChangelogEntry, b: ChangelogEntry) =>
  b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug);

/**
 * 全部条目，按日期倒序。changelog 关闭时为空。
 *
 * 条目不分语言：内容只有一份，页面外框跟着当前语言走（和法律页同一个取舍，见
 * content-collections.ts 里 changelog 的注释）。
 */
export function getEntries(): ChangelogEntry[] {
  if (!changelogEnabled) return [];
  return [...allChangelogs].sort(newestFirst);
}

export type ChangelogMonth = {
  /** `2026-09`，页面上渲染成本地化的「September 2026」。 */
  month: string;
  entries: ChangelogEntry[];
};

/**
 * 按月份分组。`entries` 已按日期倒序，所以 Map 的插入顺序就是月份的倒序，
 * 组内也保持倒序 —— 两个输出都不用再排一次。
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
