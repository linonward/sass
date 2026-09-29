import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import siteConfig from "../site.config";

const { landing } = siteConfig;
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

  await expect(
    page.locator("#delivery").getByText(t.delivery.pending),
  ).toBeVisible();
  await expect(
    page.locator("#delivery").getByText(t.delivery.terms),
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

test("导航锚点跳到对应区块", async ({ page, isMobile }) => {
  test.skip(isMobile, "移动端导航在菜单里，由 ui-shell 覆盖");
  await page.goto("/");
  await page
    .getByRole("navigation", { name: messages.Header.main })
    .getByRole("link", { name: messages.Nav.delivery })
    .click();
  await expect(page).toHaveURL("/#delivery");
  await expect(page.locator("#delivery")).toBeInViewport();
});

for (const path of ["/", "/zh"]) {
  test(`${path} 产品预览可用键盘切换且不触发 AI 请求`, async ({ page }) => {
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

test("中文 375px 亮暗主题不横向溢出", async ({ page }) => {
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
