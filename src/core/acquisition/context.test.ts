// @vitest-environment node
import { describe, expect, test } from "vitest";
import { ATTRIBUTION_SECONDS, browserEntry, captureEntry } from "./context";
import {
  readContext,
  signContext,
  sourceFromHeaders,
  SOURCE_COOKIE,
} from "./tokens";
const secret = "test-only-acquisition-signing-secret";
const now = 1_800_000_000_000;
const source = captureEntry(
  { pathname: "/", utm_source: "newsletter" },
  "example.com",
  now,
)!;
const token = signContext(
  { v: 1, purpose: "source", attribution: source },
  secret,
);

describe("entry context", () => {
  test("UTM wins over external host; same-host referral is direct", () => {
    expect(
      captureEntry(
        { pathname: "/", utm_source: "news", referrerHost: "search.test" },
        "site.test",
      )?.source,
    ).toBe("news");
    expect(
      captureEntry({ pathname: "/", referrerHost: "search.test" }, "site.test")
        ?.source,
    ).toBe("search.test");
    expect(
      captureEntry({ pathname: "/", referrerHost: "site.test" }, "site.test"),
    ).toMatchObject({ source: "direct" });
  });
  test.each([
    { pathname: "https://evil.test/" },
    { pathname: "//evil.test" },
    { pathname: "/?email=a" },
    { pathname: "/", utm_source: "<script>" },
    { pathname: "/", utm_source: "a".repeat(81) },
    { pathname: "/", referrerHost: "https://evil.test/private?x=1" },
    { pathname: "/", referrerHost: "127.0.0.1" },
    { pathname: "/", email: "a@example.com" },
  ])("rejects invalid entry %j", (entry) =>
    expect(captureEntry(entry, "site.test")).toBeNull(),
  );
  test("browser only passes allowlisted values; strips full referrer URL", () => {
    expect(
      browserEntry(
        "https://site.test/pricing?utm_source=news&email=private@example.com&token=secret",
        "https://search.test/private?q=secret",
      ),
    ).toEqual({
      pathname: "/pricing",
      utm_source: "news",
      referrerHost: "search.test",
    });
    expect(
      browserEntry(
        "https://site.test/?utm_source=a@example.com",
        "javascript:alert(1)",
      ),
    ).toEqual({ pathname: "/" });
  });
});
describe("signed attribution", () => {
  test("30 day absolute expiry; invalid and future values are unknown", () => {
    expect(
      readContext(token, secret, now + ATTRIBUTION_SECONDS * 1000 - 1)?.purpose,
    ).toBe("source");
    expect(
      readContext(token, secret, now + ATTRIBUTION_SECONDS * 1000),
    ).toBeNull();
    expect(readContext(token, secret, now - 1)).toBeNull();
    expect(sourceFromHeaders(undefined, secret, now)).toBeNull();
    expect(
      sourceFromHeaders(
        new Headers({ cookie: `${SOURCE_COOKIE}=${token}` }),
        secret,
        now,
      ),
    ).toEqual(source);
  });
  test("rejects tampering, foreign secrets and malformed signatures without throwing", () => {
    for (const invalid of [
      token.replace(/.$/, "!"),
      `${token}.extra`,
      `bad.${"é".repeat(43)}`,
      "x".repeat(4000),
    ])
      expect(readContext(invalid, secret, now)).toBeNull();
    expect(readContext(token, "different-secret", now)).toBeNull();
  });
  test("registration token is scoped to user and expires after one day; cannot be used as anonymous source", () => {
    const retry = signContext(
      {
        v: 1,
        purpose: "registration",
        attribution: source,
        registeredAt: now,
        userId: "new-user",
      },
      secret,
    );
    expect(readContext(retry, secret, now)).toMatchObject({
      userId: "new-user",
    });
    expect(readContext(retry, secret, now + 86400_000)).toBeNull();
    expect(
      sourceFromHeaders(
        new Headers({ cookie: `${SOURCE_COOKIE}=${retry}` }),
        secret,
        now,
      ),
    ).toBeNull();
  });
});
