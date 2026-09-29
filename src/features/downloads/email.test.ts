import { describe, expect, test } from "vitest";

import { renderEmail } from "@/core/email/send";

describe("download-ready email", () => {
  test("subject has the product name; body has the downloads page link and the updates-until date", async () => {
    const email = await renderEmail({
      to: "buyer@example.com",
      template: "download-ready",
      locale: "en",
      props: {
        productName: "OnwardKit template",
        downloadsUrl: "https://example.com/downloads",
        updatesUntil: "2027-09-30T00:00:00.000Z",
      },
    });
    expect(email.subject).toContain("OnwardKit template");
    expect(email.html).toContain('href="https://example.com/downloads"');
    expect(email.text).toContain("September 30, 2027");
  });
});
