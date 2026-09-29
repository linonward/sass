// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test } from "vitest";

import messages from "../../../messages/en.json";

import { NO_SOURCE_BUCKET } from "./report";
import type { FilterOptions } from "./report";
import { chooseOption, optionLabels, selectedValue } from "@/core/ui/testing";

import { ReportFilters, sourceLabel } from "./report-filters";

describe("sourceLabel", () => {
  const labels = { unknown: "No attribution", direct: "Direct" };

  test("合成桶显示成文案里的名字，快照里的取值原样显示", () => {
    expect(sourceLabel(NO_SOURCE_BUCKET, labels)).toBe("No attribution");
    expect(sourceLabel("direct", labels)).toBe("Direct");
    expect(sourceLabel("news.ycombinator.com", labels)).toBe(
      "news.ycombinator.com",
    );
    // 真的把 utm_source 填成 unknown 的流量：字面量照原样显示，和合成桶区分开。
    expect(sourceLabel("unknown", labels)).toBe("unknown");
  });
});

const options: FilterOptions = {
  sources: ["twitter"],
  mediums: [],
  campaigns: [],
};

/**
 * 同一棵树里换 props 就是「客户端跳转换了 searchParams」：路由不变时 React 不会
 * 重新挂载节点，只更新 props —— 只用 defaultValue 的话 select 会停在旧值上。
 */
function renderFilters(
  current: { source?: string; medium?: string },
  filterOptions: FilterOptions = options,
) {
  const ui = (props: typeof current) => (
    <NextIntlClientProvider locale="en" messages={messages}>
      <ReportFilters
        action="/admin/acquisition"
        options={filterOptions}
        current={props}
        range={7}
      />
    </NextIntlClientProvider>
  );
  const view = render(ui(current));
  return {
    ...view,
    show: (next: typeof current) => view.rerender(ui(next)),
  };
}

/** The select's current value, read from its hidden input (no jest-dom here; read the DOM). */
const shown = (name: string) => selectedValue(document.body, name);

const trigger = (label: string) =>
  screen.getByLabelText(label, { exact: true });

describe("渠道筛选", () => {
  test("URL 的筛选变化后，下拉显示跟着变", () => {
    const view = renderFilters({});
    const source = messages.Admin.acquisition.filters;
    expect(shown("source")).toBe("");
    expect(trigger(source.source).textContent).toContain(source.allSources);

    view.show({ source: "twitter" });
    expect(shown("source")).toBe("twitter");
    expect(trigger(source.source).textContent).toContain("twitter");

    // 回到不带筛选的 URL：下拉也回到「全部」。
    view.show({});
    expect(shown("source")).toBe("");
    expect(trigger(source.source).textContent).toContain(source.allSources);
  });

  test("手写 URL 里数据中没有的取值也留在框里", () => {
    renderFilters({ source: "e2e-never-used" });
    expect(shown("source")).toBe("e2e-never-used");
    expect(
      trigger(messages.Admin.acquisition.filters.source).textContent,
    ).toContain("e2e-never-used");
  });

  // 表格里出现的每一行都要能选到，包括「没有可用归因」那一行：筛选框里的取值来自
  // getFilterOptions，它同时喂给表格和下拉，两边必须是同一份。
  test("合成桶在下拉里是自己的选项，显示成文案里的名字", async () => {
    renderFilters(
      { source: NO_SOURCE_BUCKET },
      { ...options, sources: [NO_SOURCE_BUCKET, "twitter"] },
    );
    const source = trigger(messages.Admin.acquisition.filters.source);
    expect(await optionLabels(source)).toEqual(
      expect.arrayContaining([messages.Admin.acquisition.unknown, "twitter"]),
    );
    // 选中的就是它自己：显示成「No attribution」的那一项，值仍是合成桶的取值。
    expect(source.textContent).toContain(messages.Admin.acquisition.unknown);
    expect(shown("source")).toBe(NO_SOURCE_BUCKET);
  });

  test("a chosen value submits with the GET form", async () => {
    const view = renderFilters({});
    await chooseOption(
      trigger(messages.Admin.acquisition.filters.source),
      "twitter",
    );
    const form = view.container.querySelector("form")!;
    expect(new FormData(form).get("source")).toBe("twitter");
  });
});
