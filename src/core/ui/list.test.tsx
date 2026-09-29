import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type * as React from "react";
import { describe, expect, test, vi } from "vitest";

import messages from "../../../messages/en.json";
import {
  cleanQuery,
  EmptyRow,
  ListToolbar,
  Pagination,
  StatusFilter,
} from "./list";

type Href = string | { pathname: string; query?: Record<string, string> };

// Render the locale-aware Link as a plain anchor with the URL it would produce.
vi.mock("@/core/i18n/navigation", () => ({
  Link: ({ href, ...props }: { href: Href } & Record<string, unknown>) => {
    const url =
      typeof href === "string"
        ? href
        : `${href.pathname}${
            href.query && Object.keys(href.query).length
              ? `?${new URLSearchParams(href.query)}`
              : ""
          }`;
    return <a href={url} {...props} />;
  },
}));

const l = messages.Common.list;

function renderIn(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("cleanQuery", () => {
  test("drops empty values and page 1, keeps the rest", () => {
    expect(cleanQuery({ q: "acme", status: undefined, page: "1" })).toEqual({
      q: "acme",
    });
    expect(cleanQuery({ q: "", page: "3" })).toEqual({ page: "3" });
  });
});

describe("ListToolbar", () => {
  test("is a GET search form that starts over on page 1 and keeps other filters", () => {
    const { container } = renderIn(
      <ListToolbar
        pathname="/admin/orders"
        value="acme"
        label="Search orders"
        submitLabel="Search"
        keep={{ status: "paid", page: "4", q: "old", empty: "" }}
      />,
    );
    const form = container.querySelector("form")!;
    expect(form.getAttribute("role")).toBe("search");
    expect(form.getAttribute("action")).toBe("/admin/orders");
    expect(form.method).toBe("get");

    const box = screen.getByRole("searchbox", { name: "Search orders" });
    expect((box as HTMLInputElement).value).toBe("acme");
    // Only the other filter survives: no page (new search → page 1), no stale
    // copy of the search param, no empty values.
    expect(Object.fromEntries(new FormData(form))).toEqual({
      status: "paid",
      q: "acme",
    });
  });

  test("renders the filter slot beside the search", () => {
    renderIn(
      <ListToolbar
        pathname="/invoices"
        value=""
        label="Search"
        submitLabel="Search"
      >
        <span>filters</span>
      </ListToolbar>,
    );
    expect(screen.getByText("filters")).toBeDefined();
  });
});

describe("StatusFilter", () => {
  test("marks the current status and links keep the other group, dropping page", () => {
    renderIn(
      <StatusFilter
        pathname="/admin/orders"
        statuses={["paid", "refunded"] as const}
        current="paid"
        label={(status) => status.toUpperCase()}
        query={{ kind: "one_time", page: "3" }}
      />,
    );
    const nav = screen.getByRole("navigation", { name: l.filterLabel });
    expect(
      within(nav)
        .getByRole("link", { name: "PAID" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      within(nav).getByRole("link", { name: l.all }).getAttribute("href"),
    ).toBe("/admin/orders?kind=one_time&page=3");
    expect(
      within(nav).getByRole("link", { name: "REFUNDED" }).getAttribute("href"),
    ).toBe("/admin/orders?kind=one_time&page=3&status=refunded");
  });
});

describe("Pagination", () => {
  test("keeps the query, omits page=1, and disables the ends", () => {
    renderIn(
      <Pagination
        pathname="/invoices"
        query={{ q: "acme" }}
        page={2}
        totalPages={2}
        total={15}
      />,
    );
    const nav = screen.getByRole("navigation", { name: l.pagination });
    const previous = within(nav).getByRole("link", { name: l.previous });
    const next = within(nav).getByRole("link", { name: l.next });
    expect(previous.getAttribute("href")).toBe("/invoices?q=acme");
    expect(previous.getAttribute("aria-disabled")).toBe("false");
    expect(next.getAttribute("aria-disabled")).toBe("true");
    expect(next.getAttribute("tabindex")).toBe("-1");
    expect(nav.textContent).toContain("Page 2 of 2");
  });
});

describe("EmptyRow", () => {
  function table(row: React.ReactNode) {
    return renderIn(
      <table>
        <tbody>{row}</tbody>
      </table>,
    );
  }

  test("without filters it's the plain empty text, no clear link", () => {
    table(<EmptyRow colSpan={3} text="No invoices yet" />);
    expect(screen.getByText("No invoices yet")).toBeDefined();
    expect(screen.queryByRole("link", { name: l.clearFilters })).toBeNull();
  });

  test("with filters it says nothing matched and links to the unfiltered list", () => {
    table(
      <EmptyRow
        colSpan={3}
        text="No invoices yet"
        filtered={{ pathname: "/admin/acquisition", keep: { range: "7" } }}
      />,
    );
    expect(screen.queryByText("No invoices yet")).toBeNull();
    expect(screen.getByText(l.noResults)).toBeDefined();
    expect(
      screen.getByRole("link", { name: l.clearFilters }).getAttribute("href"),
    ).toBe("/admin/acquisition?range=7");
  });

  test("the caller can word the no-match text", () => {
    table(
      <EmptyRow
        colSpan={3}
        text="No invoices yet"
        filtered={{ pathname: "/invoices", text: "No invoices match" }}
      />,
    );
    expect(screen.getByText("No invoices match")).toBeDefined();
  });
});
