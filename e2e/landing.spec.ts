import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import siteConfig from "../site.config";

const { landing, billing } = siteConfig;
const t = messages.Landing;

test("首页按配置顺序渲染全部区块", async ({ page }) => {
  await page.goto("/");
  const ids = await page
    .locator("[data-section]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-section")));
  expect(ids).toEqual(landing.sections);
});

test("各区块内容来自配置与文案", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: t.hero.title }),
  ).toBeVisible();
  if (landing.hero.image) {
    // 亮色、暗色各一张时，只显示其中一张。
    await expect(
      page
        .getByRole("img", { name: t.hero.imageAlt, exact: true })
        .filter({ visible: true }),
    ).toHaveCount(1);
  }

  const features = page.locator("#features");
  await expect(features.getByRole("listitem")).toHaveCount(
    landing.features.length,
  );

  const pricing = page.locator("#pricing");
  await expect(pricing.locator("[data-plan]")).toHaveCount(
    billing.plans.length,
  );
  for (const plan of billing.plans) {
    await expect(
      pricing.getByRole("heading", {
        name: t.pricing.plans[plan.id as "free"].name,
      }),
    ).toBeVisible();
  }

  const faq = page.locator("#faq");
  await expect(faq.locator("details")).toHaveCount(landing.faq.length);
  const first = t.faq.items[landing.faq[0] as "stack"];
  await expect(faq.getByText(first.answer)).toBeHidden();
  await faq.getByText(first.question).click();
  await expect(faq.getByText(first.answer)).toBeVisible();

  await expect(
    page.locator("#cta").getByRole("link", { name: t.cta.button }),
  ).toBeVisible();
});

test("导航锚点跳到对应区块", async ({ page, isMobile }) => {
  test.skip(isMobile, "移动端导航在菜单里，由 ui-shell 覆盖");
  await page.goto("/");
  await page
    .getByRole("navigation", { name: messages.Header.main })
    .getByRole("link", { name: messages.Nav.pricing })
    .click();
  await expect(page).toHaveURL("/#pricing");
  await expect(page.locator("#pricing")).toBeInViewport();
});
