import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import siteConfig from "../site.config";

const { landing } = siteConfig;
const t = messages.Landing;

test("home page renders all sections in config order", async ({ page }) => {
  await page.goto("/");
  const ids = await page
    .locator("[data-section]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-section")));
  expect(ids).toEqual(landing.sections);
});

test("section content comes from config and messages", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: t.hero.title }),
  ).toBeVisible();
  if (landing.hero.image) {
    // With one light and one dark image, only one of them is shown.
    await expect(
      page
        .getByRole("img", { name: t.hero.imageAlt, exact: true })
        .filter({ visible: true }),
    ).toHaveCount(1);
  }

  // When there's a purchasable plan, the hero's primary button sells directly: it shows the price
  // and jumps to the purchase card in the delivery section.
  const buy = page.locator("#hero").getByRole("link", {
    name: new RegExp(`^${t.hero.buyCta.split(" ·")[0]}`),
  });
  await expect(buy).toBeVisible();
  await expect(buy).toHaveAttribute("href", /#delivery$/);

  const timesaved = page.locator("#timesaved");
  await expect(timesaved.getByRole("listitem")).toHaveCount(
    landing.timeSaved.length,
  );

  const features = page.locator("#features");
  await expect(features.getByRole("listitem")).toHaveCount(
    landing.features.length,
  );

  // The delivery section sells landing.purchasePlan: price, terms, and the buy button (the
  // checkout flow is covered by billing.spec).
  const offer = page.getByTestId("delivery-offer");
  await expect(offer).toBeVisible();
  await expect(offer.getByText(t.delivery.terms)).toBeVisible();
  await expect(
    offer.getByRole("button", { name: t.delivery.buy }),
  ).toBeVisible();
  await expect(page.locator("[data-plan]")).toHaveCount(0);

  const faq = page.locator("#faq");
  await expect(faq.locator("details")).toHaveCount(landing.faq.length);
  const first = t.faq.items[landing.faq[0] as "fit"];
  await expect(faq.getByText(first.answer)).toBeVisible();
  await faq.getByText(first.question).click();
  await expect(faq.getByText(first.answer)).toBeHidden();

  await expect(
    page.locator("#cta").getByRole("link", { name: t.cta.button }),
  ).toBeVisible();
});

test("nav anchors jump to their sections", async ({ page, isMobile }) => {
  test.skip(
    isMobile,
    "mobile nav lives in the menu and is covered by ui-shell",
  );
  await page.goto("/");
  await page
    .getByRole("navigation", { name: messages.Header.main })
    .getByRole("link", { name: messages.Nav.delivery })
    .click();
  await expect(page).toHaveURL("/#delivery");
  await expect(page.locator("#delivery")).toBeInViewport();
});

for (const path of ["/", "/zh"]) {
  test(`${path} product preview is keyboard-switchable and makes no AI requests`, async ({
    page,
  }) => {
    const aiRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/ai/")) aiRequests.push(request.url());
    });
    await page.goto(path);
    const hero = page.locator("#hero");
    const tabs = hero.getByRole("tab");
    const layout = () =>
      page.evaluate(() => ({
        heroHeight: document.querySelector("#hero")!.getBoundingClientRect()
          .height,
        nextSectionTop: (document.querySelector("#features") as HTMLElement)
          .offsetTop,
      }));
    const initialLayout = await layout();
    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(hero.getByRole("table")).toBeVisible();
    await expect.poll(layout).toEqual(initialLayout);
    await expect(hero.getByRole("tabpanel")).toHaveCount(1);
    await page.keyboard.press("Home");
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    await expect(hero.getByRole("img")).toBeVisible();
    await expect.poll(layout).toEqual(initialLayout);
    expect(aiRequests).toEqual([]);
    const demoLink = hero.locator('a[href$="/demo"]');
    await expect(demoLink).toHaveCount(1);
    await demoLink.click();
    await expect(page).toHaveURL(path === "/zh" ? "/zh/demo" : "/demo");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
}

test("zh at 375px doesn't overflow horizontally in light or dark theme", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/zh");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
  }
});

for (const path of ["/", "/zh"]) {
  test(`${path} user stories follow config, theme, and brand color, with no overflow at 375px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 375, height: 812 });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(path);
      const wall = page.locator("#testimonials");
      await wall.scrollIntoViewIfNeeded();
      await expect(wall.getByRole("heading", { level: 2 })).toBeVisible();
      await expect(wall.locator("article")).toHaveCount(
        landing.testimonials.items.length,
      );
      await expect(wall.locator("mark")).toHaveCount(
        landing.testimonials.items.length,
      );
      await expect(wall.getByRole("img")).toHaveCount(2);
      for (const img of await wall.getByRole("img").all()) {
        await img.scrollIntoViewIfNeeded();
        await expect
          .poll(() =>
            img.evaluate((el) => (el as HTMLImageElement).naturalWidth),
          )
          .toBeGreaterThan(0);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(0);
      const mark = wall.locator("mark").first();
      const before = await mark.evaluate(
        (el) => getComputedStyle(el).backgroundColor,
      );
      const swatch = page.locator('button[aria-label$="#4f46e5"]').first();
      await swatch.click();
      await expect
        .poll(() => mark.evaluate((el) => getComputedStyle(el).backgroundColor))
        .not.toBe(before);
    }
    expect(errors).toEqual([]);
  });
}
