/**
 * 更新日志的站内路径（不含语言前缀）。
 *
 * 单独放一个文件、不 import 任何东西：页脚要按开关隐藏入口（`core/layout/footer-nav.ts`），
 * 而 `entries.ts` 会拖进 content-collections —— 渲染页脚的每个页面不该为此被牵连。
 */

export const changelogPath = "/changelog";

export const feedPath = `${changelogPath}/rss.xml`;

/**
 * 条目在页面上的锚点（页面上每条都有 `id="<slug>"`）。
 * 更新日志是单页，没有每条一页的详情页，但 RSS 的每条都得有自己的地址 —— 否则所有
 * 条目的 guid 相同，阅读器会把它们当成同一条。
 */
export const entryAnchor = (slug: string) => `${changelogPath}#${slug}`;
