import { expect, test } from "@playwright/test";
import messages from "../messages/en.json";

test("default-off acquisition has no UI, cookies, API requests or enabled endpoint", async ({
  page,
}) => {
  const requests: string[] = [];
  const scripts: Promise<string>[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "script")
      scripts.push(response.text().catch(() => ""));
  });
  page.on("request", (request) => {
    if (request.url().includes("/api/acquisition"))
      requests.push(request.url());
  });
  await page.goto("/?utm_source=disabled");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByRole("button", { name: messages.Acquisition.preferences }),
  ).toHaveCount(0);
  expect(requests).toEqual([]);
  expect(
    (await Promise.all(scripts)).some((script) =>
      script.includes("acquisition-source-choice"),
    ),
  ).toBe(false);
  expect(
    (await page.context().cookies()).some((c) =>
      c.name.startsWith("acquisition_"),
    ),
  ).toBe(false);
  expect(
    (await page.request.get("/api/acquisition/attribution")).status(),
  ).toBe(404);
});
