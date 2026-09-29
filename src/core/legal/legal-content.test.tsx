import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test } from "vitest";

import privacy from "../../../content/legal/privacy";
import refund from "../../../content/legal/refund";
import terms from "../../../content/legal/terms";
import siteConfig from "../../../site.config";
import { paymentProcessors } from "../billing/processor";
import type { LegalDocument } from "./document";

// 法律页按生效的支付商写名称和角色（MoR / 支付处理方），不写死某一家。
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

describe("法律页里的支付商", () => {
  test.each([terms, privacy, refund])(
    "MoR（Waffo Pancake）：写成经销商兼 MoR，不出现 Creem",
    (doc) => {
      const content = text(doc, "waffo");
      expect(content).toContain("Waffo Pancake");
      expect(content).toMatch(/Merchant of Record/);
      expect(content).not.toContain("Creem");
    },
  );

  test.each([terms, privacy, refund])(
    "非 MoR（Stripe）：写成支付处理方，不自称 MoR",
    (doc) => {
      const content = text(doc, "stripe");
      expect(content).toContain("Stripe");
      expect(content).toContain("payment processor");
      expect(content).not.toMatch(
        /Merchant of Record, Stripe|Stripe, our reseller/,
      );
    },
  );

  test("退款政策：数字产品售出不退款，重复 / 未授权扣款除外", () => {
    const content = text(refund, "waffo");
    expect(content).toContain("final and non-refundable");
    expect(content).toContain("Duplicate or unauthorized charges");
  });
});
