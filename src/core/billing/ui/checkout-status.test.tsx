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

describe("CheckoutStatus next step", () => {
  test("a plan with a next step shows its description and uses it as the primary button", async () => {
    renderStatus("lifetime");
    expect(await screen.findByText("Link emailed.")).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "Go to downloads" })
        .getAttribute("href"),
    ).toMatch(/\/downloads$/);
    expect(screen.queryByRole("link", { name: t.toBilling })).toBeNull();
  });

  test("a plan without one still goes to the billing page", async () => {
    renderStatus("pro");
    expect(
      (await screen.findByRole("link", { name: t.toBilling })).getAttribute(
        "href",
      ),
    ).toMatch(/\/billing$/);
    expect(screen.queryByText("Link emailed.")).toBeNull();
  });
});
