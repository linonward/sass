import { describe, expect, test, vi } from "vitest";

import { handleCronRecovery } from "./handler";

const SECRET = "a-long-enough-cron-secret";

function request(authorization?: string) {
  return new Request("http://localhost/api/cron/recovery", {
    headers: authorization ? { authorization } : {},
  });
}

describe("handleCronRecovery", () => {
  test("CRON_SECRET not set: 404, does not run", async () => {
    const run = vi.fn(async () => ({ ran: true }));
    const response = await handleCronRecovery(request(`Bearer ${SECRET}`), {
      secret: undefined,
      run,
    });
    expect(response.status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });

  test.each([
    ["no Authorization header", undefined],
    ["wrong secret", "Bearer wrong-secret-of-some-length"],
    ["missing Bearer prefix", SECRET],
    ["extra suffix", `Bearer ${SECRET}x`],
  ])("%s: 401, does not run", async (_, header) => {
    const run = vi.fn(async () => ({ ran: true }));
    const response = await handleCronRecovery(request(header), {
      secret: SECRET,
      run,
    });
    expect(response.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  test("correct secret: runs once and returns the summary, uncached", async () => {
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
