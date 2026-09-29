import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test, vi } from "vitest";

import messages from "../../../../messages/en.json";
import { CheckoutStatus } from "./checkout-status";

const t = messages.Billing.success;

function renderStatus(planId: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ status: "complete", planId })),
  );
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CheckoutStatus
        reference={{ orderId: "ord_1" }}
        timeoutMs={10_000}
        supportEmail="support@example.com"
        planNames={{ lifetime: "Lifetime", pro: "Pro" }}
        nextSteps={{
          lifetime: {
            note: "Link emailed.",
            href: "/downloads",
            label: "Go to downloads",
          },
        }}
      />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CheckoutStatus 的下一步", () => {
  test("套餐配了下一步：显示说明，主按钮换成它", async () => {
    renderStatus("lifetime");
    expect(await screen.findByText("Link emailed.")).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "Go to downloads" })
        .getAttribute("href"),
    ).toMatch(/\/downloads$/);
    expect(screen.queryByRole("link", { name: t.toBilling })).toBeNull();
  });

  test("没配的套餐照常是账单页", async () => {
    renderStatus("pro");
    expect(
      (await screen.findByRole("link", { name: t.toBilling })).getAttribute(
        "href",
      ),
    ).toMatch(/\/billing$/);
    expect(screen.queryByText("Link emailed.")).toBeNull();
  });
});
