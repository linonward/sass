import { expect, test, type Page } from "@playwright/test";

import messages from "../messages/en.json";
import { signIn, uniqueEmail, useRandomIp } from "./auth-helpers";

const p = messages.Playground;

// The reply is canned: /api/ai/chat is answered here with a UI message stream (the same SSE
// format toUIMessageStreamResponse writes), so no model key or credits are needed and the
// markdown under test is fixed.
const REPLY = [
  "Here is a **TypeScript** helper:",
  "",
  "```typescript",
  "type SortOrder = 'asc' | 'desc';",
  "",
  "function sortBy<T>(arr: T[], key: keyof T, order: SortOrder = 'asc'): T[] {",
  "  return [...arr].sort((a, b) => (a[key] < b[key] ? -1 : 1) * (order === 'asc' ? 1 : -1));",
  "}",
  "```",
  "",
  "- ascending by default",
  "- returns a new array",
].join("\n");

async function stubChat(page: Page) {
  await page.route("**/api/ai/chat", (route) => {
    const chunks = [
      { type: "start" },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: REPLY },
      { type: "text-end", id: "t1" },
      { type: "finish" },
    ];
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body:
        chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
        "data: [DONE]\n\n",
    });
  });
}

test.beforeEach(async ({ page }) => {
  await useRandomIp(page);
});

test("a template fills the input, and the reply renders as markdown with copy buttons", async ({
  page,
  context,
  browserName,
}) => {
  await signIn(page, uniqueEmail("playground"));
  await stubChat(page);
  await page.goto("/playground");

  const input = page.getByRole("textbox", { name: p.placeholder });
  const templates = page.getByRole("group", { name: p.templates.label });
  await templates
    .getByRole("button", { name: p.templates.chat.code.label })
    .click();
  await expect(input).toHaveValue(p.templates.chat.code.prompt);
  await expect(input).toBeFocused();

  await input.pressSequentially("sorts by a key");
  await page.getByRole("button", { name: p.send }).click();

  const reply = page.getByTestId("playground-reply");
  await expect(reply.locator('[data-streamdown="strong"]')).toHaveText(
    "TypeScript",
  );
  await expect(reply.locator("pre")).toContainText("type SortOrder");
  await expect(reply.locator("li")).toHaveCount(2);
  await expect(reply).not.toContainText("```");
  await expect(reply).not.toContainText("**");
  await expect(templates).toHaveCount(0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, "page overflows horizontally").toBeLessThanOrEqual(0);

  // Clipboard reads need a permission only Chromium grants here.
  test.skip(
    browserName !== "chromium",
    "clipboard permission is Chromium-only",
  );
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  await reply.getByRole("button", { name: p.markdown.copyCode }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "function sortBy<T>",
  );

  await page.getByRole("button", { name: p.copyReply }).click();
  await expect(page.getByRole("button", { name: p.copied })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(REPLY);
});
