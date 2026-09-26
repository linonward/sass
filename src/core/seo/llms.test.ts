import { describe, expect, test } from "vitest";

import { buildLlmsTxt, type LlmsDoc } from "./llms";

const doc: LlmsDoc = {
  name: "Acme",
  summary: "Ship your SaaS in a day.",
  intro: "Machine-readable index.",
  sections: [
    {
      title: "Product",
      items: [
        { title: "Home", url: "https://example.com", note: "what it does" },
        { title: "Pricing", url: "https://example.com/pricing" },
      ],
    },
    {
      title: "Requires an account",
      note: "Crawlers get the sign-in screen.",
      items: [{ title: "/dashboard" }, { title: "/admin" }],
    },
    { title: "Empty section", items: [] },
  ],
};

describe("buildLlmsTxt", () => {
  test("按约定排版：H1、blockquote、正文、小节", () => {
    expect(buildLlmsTxt(doc).split("\n").slice(0, 8)).toEqual([
      "# Acme",
      "",
      "> Ship your SaaS in a day.",
      "",
      "Machine-readable index.",
      "",
      "## Product",
      "- [Home](https://example.com): what it does",
    ]);
  });

  test("没有 url 的条目渲染成纯文字行", () => {
    const text = buildLlmsTxt(doc);
    expect(text).toContain(
      "## Requires an account\nCrawlers get the sign-in screen.\n- /dashboard\n- /admin",
    );
    expect(text).not.toContain("- [/dashboard]");
  });

  test("空小节整节不渲染", () => {
    const text = buildLlmsTxt(doc);
    expect(text).not.toContain("Empty section");
  });

  test("没有 optional 时不出这一节；有则排最后", () => {
    expect(buildLlmsTxt(doc)).not.toContain("Optional");

    const withOptional = buildLlmsTxt({
      ...doc,
      optional: {
        title: "Optional",
        items: [{ title: "Tips", url: "https://example.com/blog/tags/tips" }],
      },
    });
    expect(
      withOptional
        .trimEnd()
        .endsWith("- [Tips](https://example.com/blog/tags/tips)"),
    ).toBe(true);
  });

  test("结尾是一个换行", () => {
    const text = buildLlmsTxt(doc);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });
});
