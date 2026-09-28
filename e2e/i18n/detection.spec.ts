import { expect, test, type BrowserContext } from "@playwright/test";

import messages from "../../messages/en.json";
import { LOCALE_COOKIE } from "../../src/core/i18n/locale-cookie";
import { TEST_LOCALE } from "./test-locale";

const tr = (text: string) => `[${TEST_LOCALE}] ${text}`;

// Playwright 的 locale 选项同时设置 Accept-Language 和 navigator.language，
// 正是浏览器语言检测要看的东西。
const DE_BROWSER = { locale: TEST_LOCALE };
const EN_BROWSER = { locale: "en-US" };
/** 本站没有的语言：应当回落到默认语言，而不是跳转。 */
const UNKNOWN_BROWSER = { locale: "fr-FR" };

/** 语言 cookie 当前的值；从没写过时是 undefined。 */
async function localeCookie(context: BrowserContext) {
  const cookies = await context.cookies();
  return cookies.find((cookie) => cookie.name === LOCALE_COOKIE)?.value;
}

test.describe("浏览器语言是本站支持的语言", () => {
  test.use(DE_BROWSER);

  test("首页跳到该语言", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(`/${TEST_LOCALE}`);
    await expect(page.locator("html")).toHaveAttribute("lang", TEST_LOCALE);
  });

  test("深层链接同样跳", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page).toHaveURL(`/${TEST_LOCALE}/pricing`);
    await expect(
      page.getByRole("navigation", { name: tr(messages.Header.main) }),
    ).toBeVisible();
  });

  // 地址里的前缀是用户明确指定的语言，优先级最高：分享出去的 /zh 链接不会被
  // 收件人的浏览器语言改写。
  test("带前缀的地址不受浏览器语言影响", async ({ page }) => {
    await page.goto("/zh/pricing");
    await expect(page).toHaveURL("/zh/pricing");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh");
  });

  // 跳转必须是 307：语言偏好会变，301/308 会被浏览器和搜索引擎长期记住，改不回来。
  // Vary 是给缓存看的：不带前缀的地址跳到哪门语言取决于 Accept-Language，缓存键得带上它，
  // 否则中文访客的跳转会发给英文访客（反向也一样）。
  // 只有中间件自己返回的响应（跳转）带得上这个头：Next 会重建 200 响应的 Vary，
  // 中间件加的值到不了客户端 —— 见 src/proxy.ts 的注释，那里也解释了为什么这样够用。
  test("跳转是 307 且带 Vary: Accept-Language", async ({ request }) => {
    const redirect = await request.get("/", {
      headers: { "accept-language": TEST_LOCALE },
      maxRedirects: 0,
    });
    expect(redirect.status()).toBe(307);
    expect(redirect.headers()["location"]).toBe(`/${TEST_LOCALE}`);
    expect(redirect.headers()["vary"]).toContain("Accept-Language");
  });

  // proxy 只给不带前缀的响应加 Vary（带前缀的地址永远是它自己那门语言）。这条现在是
  // 双保险：无论那个头是我的代码加的，还是 Next 重建的，带前缀的响应里都不该有它。
  test("带前缀的地址不带 Vary", async ({ request }) => {
    const response = await request.get(`/${TEST_LOCALE}`, {
      headers: { "accept-language": "en-US" },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["vary"] ?? "").not.toContain("Accept-Language");
  });
});

test.describe("浏览器语言本站没有", () => {
  test.use(UNKNOWN_BROWSER);

  test("留在默认语言，不跳转", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});

// 「访问了某语言的页面」不等于「选了这门语言」：分享链接的收件人点开一次 /de，
// 之后访问首页不该被永久送去德语站。cookie 只由语言切换器写（core/i18n/locale-switcher.tsx），
// proxy 会把中间件自己写的那份删掉（src/proxy.ts）。
test.describe("访问带前缀的地址不写语言 cookie", () => {
  test.use(EN_BROWSER);

  test("点开 /de 链接的英文访客，之后访问首页仍在英文站", async ({
    page,
    context,
  }) => {
    await page.goto(`/${TEST_LOCALE}`);
    await expect(page.locator("html")).toHaveAttribute("lang", TEST_LOCALE);
    expect(await localeCookie(context)).toBeUndefined();

    await page.goto("/");
    await expect(page).toHaveURL("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});

test.describe("主动切换会被记住", () => {
  test.use(DE_BROWSER);

  test("切成英文后，浏览器语言也不再把人送回德语站", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(`/${TEST_LOCALE}`);

    await page
      .getByRole("button", { name: tr(messages.Locale.switch) })
      .click();
    await page.getByRole("menuitemradio", { name: "English" }).click();
    await expect(page).toHaveURL("/");
    expect(await localeCookie(context)).toBe("en");

    // cookie 优先于 Accept-Language，否则中文/德文浏览器切到英文只是这一次有效。
    await page.goto("/");
    await expect(page).toHaveURL("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});
