// @vitest-environment node
import { describe, expect, test } from "vitest";

import { describeUserAgent } from "./user-agent";

const UA = {
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1",
  chromeIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  firefoxLinux:
    "Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  operaWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/125.0.0.0",
};

describe("describeUserAgent", () => {
  test.each([
    ["chromeMac", "Chrome", "macOS"],
    ["safariMac", "Safari", "macOS"],
    ["safariIphone", "Safari", "iOS"],
    ["chromeIos", "Chrome", "iOS"],
    ["edgeWindows", "Edge", "Windows"],
    ["firefoxLinux", "Firefox", "Linux"],
    ["chromeAndroid", "Chrome", "Android"],
    ["operaWindows", "Opera", "Windows"],
  ] as const)("%s → %s on %s", (name, browser, os) => {
    expect(describeUserAgent(UA[name])).toEqual({ kind: "known", browser, os });
  });

  test("an unrecognized agent falls back to a shortened raw string", () => {
    expect(describeUserAgent("curl/8.9.1")).toEqual({
      kind: "raw",
      text: "curl/8.9.1",
    });
    const long = describeUserAgent(`SomeBot/1.0 ${"x".repeat(100)}`);
    expect(long.kind).toBe("raw");
    expect(long.kind === "raw" && long.text.length).toBe(48);
    expect(long.kind === "raw" && long.text.endsWith("…")).toBe(true);
  });

  test("no user agent at all is unknown", () => {
    expect(describeUserAgent(null)).toEqual({ kind: "unknown" });
    expect(describeUserAgent("  ")).toEqual({ kind: "unknown" });
  });
});
