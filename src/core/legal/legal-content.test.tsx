import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test } from "vitest";

import privacy from "../../../content/legal/privacy";
import refund from "../../../content/legal/refund";
import terms from "../../../content/legal/terms";
import siteConfig from "../../../site.config";
import { paymentProcessors } from "../billing/processor";
import type { LegalDocument } from "./document";

// Legal pages name the active payment provider and its role (MoR / payment processor) instead of
// hard-coding one.
function text(
  document: LegalDocument,
  provider: keyof typeof paymentProcessors,
) {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={{}}>
      <document.Content
        legal={siteConfig.legal}
        site={{ name: "OnwardKit", domain: "onwardkit.test" }}
        email={<a href="mailto:support@example.com">support@example.com</a>}
        payments={paymentProcessors[provider]}
      />
    </NextIntlClientProvider>,
  );
  return container.textContent ?? "";
}

describe("payment provider in legal pages", () => {
  test.each([terms, privacy, refund])(
    "MoR (Waffo Pancake): described as reseller and MoR, Creem never mentioned",
    (doc) => {
      const content = text(doc, "waffo");
      expect(content).toContain("Waffo Pancake");
      expect(content).toMatch(/Merchant of Record/);
      expect(content).not.toContain("Creem");
    },
  );

  test.each([terms, privacy, refund])(
    "non-MoR (Stripe): described as payment processor, never claims to be the MoR",
    (doc) => {
      const content = text(doc, "stripe");
      expect(content).toContain("Stripe");
      expect(content).toContain("payment processor");
      expect(content).not.toMatch(
        /Merchant of Record, Stripe|Stripe, our reseller/,
      );
    },
  );

  test("refund policy: no refunds on digital products once sold, except duplicate / unauthorized charges", () => {
    const content = text(refund, "waffo");
    expect(content).toContain("final and non-refundable");
    expect(content).toContain("Duplicate or unauthorized charges");
  });
});
