// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test } from "vitest";

import messages from "../../../messages/en.json";

import { NO_SOURCE_BUCKET } from "./report";
import type { FilterOptions } from "./report";
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

/** 下拉当前显示的值（仓库的测试不装 jest-dom，直接读 DOM）。 */
const shown = (label: string) =>
  (screen.getByLabelText(label, { exact: true }) as HTMLSelectElement).value;

const select = (label: string) =>
  screen.getByLabelText(label, { exact: true }) as HTMLSelectElement;

describe("渠道筛选", () => {
  test("URL 的筛选变化后，下拉显示跟着变", () => {
    const view = renderFilters({});
    const source = messages.Admin.acquisition.filters.source;
    expect(shown(source)).toBe("");

    view.show({ source: "twitter" });
    expect(shown(source)).toBe("twitter");

    // 回到不带筛选的 URL：下拉也回到「全部」。
    view.show({});
    expect(shown(source)).toBe("");
  });

  test("手写 URL 里数据中没有的取值也留在框里", () => {
    renderFilters({ source: "e2e-never-used" });
    expect(shown(messages.Admin.acquisition.filters.source)).toBe(
      "e2e-never-used",
    );
  });

  // 表格里出现的每一行都要能选到，包括「没有可用归因」那一行：筛选框里的取值来自
  // getFilterOptions，它同时喂给表格和下拉，两边必须是同一份。
  test("合成桶在下拉里是自己的选项，显示成文案里的名字", () => {
    renderFilters(
      { source: NO_SOURCE_BUCKET },
      { ...options, sources: [NO_SOURCE_BUCKET, "twitter"] },
    );
    const source = messages.Admin.acquisition.filters.source;
    const entries = [...select(source).options].map((option) => [
      option.value,
      option.textContent,
    ]);
    expect(entries).toContainEqual([
      NO_SOURCE_BUCKET,
      messages.Admin.acquisition.unknown,
    ]);
    expect(entries).toContainEqual(["twitter", "twitter"]);
    // 选中的就是它自己：显示成「No attribution」的那一项，值仍是合成桶的取值。
    expect(select(source).value).toBe(NO_SOURCE_BUCKET);
  });
});
