import type { SiteConfig } from "./schema";

/** 一处还停在出厂占位值、上线会露馅的配置。 */
export type PlaceholderIssue = {
  /** 配置里的字段路径，例如 `legal.companyName`。 */
  path: string;
  /** 出厂值本身。 */
  placeholder: string;
  /** 怎么改，会出现在提示里。 */
  hint: string;
};

/**
 * 出厂的占位值。买家不改就上线，站上会挂着 "Acme"、example.com 和 example.com 的发件地址。
 *
 * 这些字段都能用环境变量覆盖（见 site.config.ts 顶部），所以演示站不必把真实值写进仓库，
 * 也就不会随买家的分发包发出去。
 */
export function placeholderIssues(config: SiteConfig): PlaceholderIssue[] {
  const issues: PlaceholderIssue[] = [];
  const check = (
    path: string,
    value: string,
    placeholder: string,
    hint: string,
  ) => {
    if (value === placeholder) issues.push({ path, placeholder, hint });
  };

  check("name", config.name, "Acme", "改成你的产品名（或设 SITE_NAME）");
  check(
    "domain",
    config.domain,
    "example.com",
    "改成你的域名（或设 SITE_DOMAIN）",
  );
  check(
    "legal.companyName",
    config.legal.companyName,
    "Acme Inc.",
    "改成你的公司或个人名称（或设 SITE_LEGAL_NAME）",
  );
  check(
    "email.fromAddress",
    config.email.fromAddress,
    "noreply@example.com",
    "改成你的发件地址（或设 SITE_EMAIL_FROM）",
  );

  return issues;
}

/** 把哨兵结果拼成一段能直接读的提示（生产构建的报错、dev 的警告用的是同一段）。 */
export function placeholderMessage(issues: PlaceholderIssue[]): string {
  return [
    "站点配置里还有出厂占位值，这样上线访客只会看到 Acme 和 example.com：",
    ...issues.map(
      (issue) => `  - ${issue.path} 还是 "${issue.placeholder}"：${issue.hint}`,
    ),
    "（演示站可以用上面那几个环境变量覆盖，不用把真实值写进仓库。）",
  ].join("\n");
}

/**
 * 占位值的处理策略：生产构建直接失败，开发环境打一行警告，测试等其他环境不吭声 ——
 * 每个测试文件都会 import site.config.ts，那里不需要刷屏。
 *
 * 返回值交给调用方处理（抛错 / 打印），这个模块自己不碰 console：src/core 里不允许直接用。
 */
export function placeholderAction(
  issues: PlaceholderIssue[],
  nodeEnv: string | undefined,
): { throwMessage?: string; warnMessage?: string } {
  if (issues.length === 0) return {};
  const message = placeholderMessage(issues);
  if (nodeEnv === "production") return { throwMessage: message };
  if (nodeEnv === "development") return { warnMessage: message };
  return {};
}
