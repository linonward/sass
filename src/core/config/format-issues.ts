type Issue = {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
};

/** Formats validation issues as one `field.path: reason` per line; shared by config and env errors. */
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
