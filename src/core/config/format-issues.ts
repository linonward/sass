type Issue = {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
};

/** 把校验问题格式化为逐行的 `字段路径: 原因`，供配置和 env 报错共用。 */
export function formatIssues(issues: readonly Issue[]): string {
  return issues
    .map((issue) => {
      const path = (issue.path ?? [])
        .map((segment) =>
          typeof segment === "object" ? String(segment.key) : String(segment),
        )
        .join(".");
      return `  - ${path || "(root)"}: ${issue.message}`;
    })
    .join("\n");
}
