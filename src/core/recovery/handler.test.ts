import { describe, expect, test, vi } from "vitest";

import { handleCronRecovery } from "./handler";

const SECRET = "a-long-enough-cron-secret";

function request(authorization?: string) {
  return new Request("http://localhost/api/cron/recovery", {
    headers: authorization ? { authorization } : {},
  });
}

describe("handleCronRecovery", () => {
  test("没设 CRON_SECRET：404，不跑", async () => {
    const run = vi.fn(async () => ({ ran: true }));
    const response = await handleCronRecovery(request(`Bearer ${SECRET}`), {
      secret: undefined,
      run,
    });
    expect(response.status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });

  test.each([
    ["没有 Authorization 头", undefined],
    ["密钥不对", "Bearer wrong-secret-of-some-length"],
    ["少了 Bearer 前缀", SECRET],
    ["多了后缀", `Bearer ${SECRET}x`],
  ])("%s：401，不跑", async (_, header) => {
    const run = vi.fn(async () => ({ ran: true }));
    const response = await handleCronRecovery(request(header), {
      secret: SECRET,
      run,
    });
    expect(response.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  test("密钥正确：跑一次并返回汇总，不缓存", async () => {
    const run = vi.fn(async () => ({
      ran: true,
      results: { ai: { scanned: 2 } },
    }));
    const response = await handleCronRecovery(request(`Bearer ${SECRET}`), {
      secret: SECRET,
      run,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ran: true,
      results: { ai: { scanned: 2 } },
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
