import { describe, expect, test } from "vitest";

import { renderEmail } from "@/core/email/send";

describe("download-ready 邮件", () => {
  test("标题带产品名，正文有下载页链接和更新截止日期", async () => {
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
