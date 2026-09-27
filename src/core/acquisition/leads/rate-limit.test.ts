// @vitest-environment node
import { expect, test, vi } from "vitest";
vi.mock("@/core/env", () => ({
  env: {
    BETTER_AUTH_SECRET: "test-secret",
    UPSTASH_REDIS_REST_URL: undefined,
    UPSTASH_REDIS_REST_TOKEN: undefined,
  },
}));
vi.mock("@/core/observability/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));
import {
  createLeadLimit,
  checkLeadLimit,
  checkLeadActionLimit,
} from "./rate-limit";
test("independent IP/email budgets use irreversible identifiers and either can block", async () => {
  const check = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, retryAfter: 0 })
    .mockResolvedValueOnce({ ok: false, reason: "limited", retryAfter: 60 });
  expect(
    await createLeadLimit(check, "secret")("private@example.com", "192.0.2.1"),
  ).toEqual({ ok: false, reason: "limited", retryAfter: 60 });
  expect(check.mock.calls.map(([policy]) => policy)).toEqual([
    "lead-ip",
    "lead-email",
  ]);
  for (const [, key] of check.mock.calls) expect(key).toMatch(/^[a-f0-9]{64}$/);
});
test("missing IP and missing Redis fail closed for submissions and token actions", async () => {
  const check = vi.fn();
  expect(
    await createLeadLimit(check, "secret")("private@example.com", null),
  ).toMatchObject({ ok: false, reason: "unavailable" });
  expect(check).not.toHaveBeenCalled();
  expect(
    await checkLeadLimit("private@example.com", "192.0.2.1"),
  ).toMatchObject({ ok: false, reason: "unavailable" });
  expect(await checkLeadActionLimit("192.0.2.1")).toMatchObject({
    ok: false,
    reason: "unavailable",
  });
});
