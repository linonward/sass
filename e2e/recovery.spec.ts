import { expect, test } from "@playwright/test";

// 恢复入口（src/core/recovery）。CI 不设 CRON_SECRET：入口必须是关着的 404，
// 带什么 Authorization 头都一样 —— 没配密钥时不能静默放行。
test.skip(!!process.env.CRON_SECRET, "设了 CRON_SECRET 时入口是开着的");

test("没设 CRON_SECRET 时恢复入口一律 404", async ({ request }) => {
  const cases: Record<string, string>[] = [
    {},
    { authorization: "Bearer anything-at-all-here" },
  ];
  for (const headers of cases) {
    const response = await request.get("/api/cron/recovery", { headers });
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  }
});
