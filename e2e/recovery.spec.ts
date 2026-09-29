import { expect, test } from "@playwright/test";

// Recovery endpoint (src/core/recovery). CI doesn't set CRON_SECRET: the endpoint must be closed
// with a 404 regardless of the Authorization header — without a configured secret it must never
// silently let requests through.
test.skip(
  !!process.env.CRON_SECRET,
  "the endpoint is open when CRON_SECRET is set",
);

test("recovery endpoint always returns 404 when CRON_SECRET is unset", async ({
  request,
}) => {
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
