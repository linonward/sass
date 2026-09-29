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

  test("the synthetic bucket shows its name from the messages; snapshot values are shown as is", () => {
    expect(sourceLabel(NO_SOURCE_BUCKET, labels)).toBe("No attribution");
    expect(sourceLabel("direct", labels)).toBe("Direct");
    expect(sourceLabel("news.ycombinator.com", labels)).toBe(
      "news.ycombinator.com",
    );
    // Traffic that really sets utm_source to unknown: the literal is shown as is, distinct from the
    // synthetic bucket.
    expect(sourceLabel("unknown", labels)).toBe("unknown");
  });
});

const options: FilterOptions = {
  sources: ["twitter"],
  mediums: [],
  campaigns: [],
};

/**
 * Changing props within the same tree is what "a client-side navigation changed searchParams" looks
 * like: with the same route React doesn't remount the nodes, it only updates props — with
 * defaultValue alone the select would stay on the old value.
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

describe("channel filters", () => {
  test("the dropdowns follow when the URL filters change", () => {
    const view = renderFilters({});
    const source = messages.Admin.acquisition.filters;
    expect(shown("source")).toBe("");
    expect(trigger(source.source).textContent).toContain(source.allSources);

    view.show({ source: "twitter" });
    expect(shown("source")).toBe("twitter");
    expect(trigger(source.source).textContent).toContain("twitter");

    // Back to a URL without filters: the dropdowns go back to "all" too.
    view.show({});
    expect(shown("source")).toBe("");
    expect(trigger(source.source).textContent).toContain(source.allSources);
  });

  test("a hand-written URL value that isn't in the data stays in the select", () => {
    renderFilters({ source: "e2e-never-used" });
    expect(shown("source")).toBe("e2e-never-used");
    expect(
      trigger(messages.Admin.acquisition.filters.source).textContent,
    ).toContain("e2e-never-used");
  });

  // Every row that appears in the table must be selectable, including the "no usable attribution"
  // row: the filter values come from getFilterOptions, which feeds both the table and the
  // dropdowns, so the two must be the same set.
  test("the synthetic bucket is its own dropdown option, shown with its name from the messages", async () => {
    renderFilters(
      { source: NO_SOURCE_BUCKET },
      { ...options, sources: [NO_SOURCE_BUCKET, "twitter"] },
    );
    const source = trigger(messages.Admin.acquisition.filters.source);
    expect(await optionLabels(source)).toEqual(
      expect.arrayContaining([messages.Admin.acquisition.unknown, "twitter"]),
    );
    // The selected option is the bucket itself: the item shown as "No attribution", whose value is
    // still the synthetic bucket's value.
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
