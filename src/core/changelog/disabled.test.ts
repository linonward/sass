import { describe, expect, test, vi } from "vitest";

// 关掉开关的那一支（`changelog.enabled: false`）：页面 404、feed 404、没有条目、
// sitemap 里也不登记。这一支在演示站上跑不到（演示站是开的），所以用配置替身测。
// 写法照 src/core/acquisition/auth-hook.test.ts 的 site.config 替身。
vi.mock("../../../site.config", async (original) => {
  const configModule = await original<typeof import("../../../site.config")>();
  return {
    ...configModule,
    default: {
      ...configModule.default,
      changelog: { enabled: false },
    },
  };
});
vi.mock("content-collections", () => ({ allPosts: [], allChangelogs: [] }));

import { marketingRoutes } from "@/core/seo/routes";
import { changelogPath, getEntries } from "./entries";
import { ChangelogPage, rssResponse } from "./pages";

describe("changelog.enabled: false", () => {
  test("没有条目，页面 notFound()", () => {
    expect(getEntries()).toEqual([]);
    expect(() => ChangelogPage()).toThrow();
  });

  test("feed 返回 404", async () => {
    const response = await rssResponse("en");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
  });

  test("sitemap 的登记里没有它", () => {
    expect(marketingRoutes).not.toContain(changelogPath);
  });
});
