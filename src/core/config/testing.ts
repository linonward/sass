import siteConfig from "../../../site.config";

/**
 * 把值里出现的站点域名换成固定占位（`<domain>`），快照用。
 *
 * sitemap / robots / RSS 的输出里到处是绝对地址，直接快照的话买家一改 `domain`
 * 就得跑 `pnpm test -u`。过一层这个函数，快照只锁结构和路径，域名跟随配置。
 * 断言（`toContain`、`toEqual`）不用它：那里直接写 `${siteConfig.domain}` 插值就行。
 */
export function withoutSiteDomain<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value).replaceAll(
      `https://${siteConfig.domain}`,
      "https://<domain>",
    ),
  );
}
