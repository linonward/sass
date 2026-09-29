import { describe, expect, test, vi } from "vitest";

// The flag-off branch (`changelog.enabled: false`): page 404, feed 404, no entries, and no sitemap
// registration. The demo site never exercises this branch (it has the flag on), so it is tested
// with a config stand-in, following the site.config stand-in in
// src/core/acquisition/auth-hook.test.ts.
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
  test("no entries, page calls notFound()", () => {
    expect(getEntries()).toEqual([]);
    expect(() => ChangelogPage()).toThrow();
  });

  test("feed returns 404", async () => {
    const response = await rssResponse("en");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
  });

  test("is not registered in the sitemap", () => {
    expect(marketingRoutes).not.toContain(changelogPath);
  });
});
