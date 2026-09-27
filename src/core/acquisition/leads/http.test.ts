// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { createLeadHandler } from "./http";
const service = {
  prepare: vi.fn(),
  releaseSend: vi.fn(),
  confirm: vi.fn(),
  withdraw: vi.fn(),
  withdrawEmail: vi.fn(),
  linkRegistration: vi.fn(),
};
const deps = {
  enabled: true,
  lists: [{ id: "waitlist", consentVersion: "1" }],
  locales: ["en"],
  service,
  limit: vi.fn(),
  actionLimit: vi.fn(),
  source: vi.fn(),
  consentText: vi.fn(),
  send: vi.fn(),
  warn: vi.fn(),
};
const data = {
  action: "submit",
  email: " Test@Example.com ",
  listId: "waitlist",
  consent: true,
  locale: "en",
};
const request = (body: unknown, origin = "https://site.test") =>
  new Request("https://site.test/api/acquisition/leads", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "x-forwarded-for": "192.0.2.1",
    },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  deps.limit.mockResolvedValue({ ok: true, retryAfter: 0 });
  deps.actionLimit.mockResolvedValue({ ok: true, retryAfter: 0 });
  deps.source.mockReturnValue(null);
  deps.consentText.mockResolvedValue("Launch updates only");
});
test("disabled and invalid requests never mutate or send", async () => {
  expect(
    (await createLeadHandler({ ...deps, enabled: false })(request(data)))
      .status,
  ).toBe(404);
  expect(
    (await createLeadHandler(deps)(request(data, "https://evil.test"))).status,
  ).toBe(403);
  for (const bad of [
    { ...data, consent: false },
    { ...data, listId: "unknown" },
    { ...data, locale: "xx" },
    { ...data, extra: "x".repeat(5000) },
  ])
    expect((await createLeadHandler(deps)(request(bad))).status).toBe(400);
  expect(service.prepare).not.toHaveBeenCalled();
  expect(deps.send).not.toHaveBeenCalled();
});
test("honeypot is silent; first, duplicate and confirmed submission responses match", async () => {
  const handler = createLeadHandler(deps);
  expect(
    await (await handler(request({ ...data, website: "spam" }))).json(),
  ).toEqual({ ok: true });
  expect(service.prepare).not.toHaveBeenCalled();
  service.prepare
    .mockResolvedValueOnce({
      id: "id",
      email: "test@example.com",
      confirmToken: "c",
      withdrawToken: "w",
    })
    .mockResolvedValueOnce(null);
  const first = await handler(request(data));
  const duplicate = await handler(request(data));
  expect(await first.json()).toEqual(await duplicate.json());
  expect(deps.send).toHaveBeenCalledTimes(1);
  expect(service.prepare).toHaveBeenCalledWith({
    email: "test@example.com",
    listId: "waitlist",
    consentVersion: "1",
    consentText: "Launch updates only",
    snapshot: null,
  });
});
test("blocked or unavailable limiters fail closed before storage and email", async () => {
  for (const [reason, status] of [
    ["limited", 429],
    ["unavailable", 503],
  ] as const) {
    deps.limit.mockResolvedValue({ ok: false, reason, retryAfter: 30 });
    const response = await createLeadHandler(deps)(request(data));
    expect(response.status).toBe(status);
    expect(response.headers.get("Retry-After")).toBe("30");
  }
  expect(service.prepare).not.toHaveBeenCalled();
  expect(deps.send).not.toHaveBeenCalled();
  deps.actionLimit.mockResolvedValue({
    ok: false,
    reason: "unavailable",
    retryAfter: 30,
  });
  expect(
    (
      await createLeadHandler(deps)(
        request({ action: "withdraw", token: "a".repeat(43) }),
      )
    ).status,
  ).toBe(503);
  expect(service.withdraw).not.toHaveBeenCalled();
});
test("mail failure releases current cooldown and returns retryable response without exposing identity", async () => {
  service.prepare.mockResolvedValue({
    id: "id",
    email: "test@example.com",
    confirmToken: "c",
    withdrawToken: "w",
  });
  deps.send.mockRejectedValue(new Error("secret"));
  const response = await createLeadHandler(deps)(request(data));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "retry" });
  expect(service.releaseSend).toHaveBeenCalledWith("id", "c");
  expect(deps.warn).toHaveBeenCalledWith("leads.request_failed");
});
test("token actions validate token and report expired confirmation; unknown withdrawal is idempotent", async () => {
  const handler = createLeadHandler(deps);
  expect(
    (await handler(request({ action: "confirm", token: "bad" }))).status,
  ).toBe(400);
  const token = "a".repeat(43);
  service.confirm.mockResolvedValue(false);
  expect((await handler(request({ action: "confirm", token }))).status).toBe(
    400,
  );
  service.confirm.mockResolvedValue(true);
  expect((await handler(request({ action: "confirm", token }))).status).toBe(
    200,
  );
  expect(
    await (await handler(request({ action: "withdraw", token }))).json(),
  ).toEqual({ ok: true });
  expect(service.withdraw).toHaveBeenCalledWith(token);
});
