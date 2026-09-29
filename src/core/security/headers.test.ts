// @vitest-environment node
import { describe, expect, test } from "vitest";

import {
  contentSecurityPolicy,
  securityHeaders,
  staticSecurityHeaders,
} from "./headers";

function directives(csp: string) {
  return Object.fromEntries(
    csp
      .split("; ")
      .map((part) => part.split(" "))
      .map(([name, ...values]) => [name, values]),
  );
}

describe("contentSecurityPolicy", () => {
  test("production: no 'unsafe-eval', sends upgrade-insecure-requests", () => {
    const csp = contentSecurityPolicy({ runtimeEnv: {}, isDev: false });
    expect(csp).not.toContain("'unsafe-eval'");
    expect(directives(csp)["upgrade-insecure-requests"]).toEqual([]);
  });

  test("development: adds 'unsafe-eval', no upgrade-insecure-requests", () => {
    const csp = contentSecurityPolicy({ runtimeEnv: {}, isDev: true });
    expect(directives(csp)["script-src"]).toContain("'unsafe-eval'");
    expect(directives(csp)["upgrade-insecure-requests"]).toBeUndefined();
  });

  test("the R2_PUBLIC_URL origin goes into the image, media, and connect allowlists", () => {
    const csp = contentSecurityPolicy({
      runtimeEnv: { R2_PUBLIC_URL: "https://s3.example.com" },
      isDev: false,
    });
    const parsed = directives(csp);
    for (const name of ["img-src", "media-src", "connect-src"]) {
      expect(parsed[name]).toContain("https://s3.example.com");
    }
    // Keep only the origin and drop the path.
    const withPath = contentSecurityPolicy({
      runtimeEnv: { R2_PUBLIC_URL: "https://s3.example.com/nested/path" },
      isDev: false,
    });
    expect(withPath).toContain("https://s3.example.com");
    expect(withPath).not.toContain("/nested/path");
  });

  test("a missing or invalid R2_PUBLIC_URL doesn't throw; it just drops an allowlist entry", () => {
    for (const value of [undefined, "", "  ", "not-a-url"]) {
      const csp = contentSecurityPolicy({
        runtimeEnv: { R2_PUBLIC_URL: value },
        isDev: false,
      });
      expect(csp).toContain("'self'");
      expect(csp).not.toContain("undefined");
    }
  });

  test("all key directives are present on one line (response headers can't contain newlines)", () => {
    const csp = contentSecurityPolicy({ runtimeEnv: {}, isDev: false });
    expect(csp).not.toMatch(/[\r\n]/);
    expect(csp).not.toMatch(/ {2}/);
    expect(directives(csp)).toMatchObject({
      "default-src": ["'self'"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'"],
      "frame-ancestors": ["'none'"],
      "font-src": ["'self'"],
    });
    // The Vercel Analytics / Speed Insights script origin; Sentry's /monitoring is same-origin and
    // covered by 'self'.
    expect(directives(csp)["script-src"]).toContain(
      "https://va.vercel-scripts.com",
    );
    expect(directives(csp)["connect-src"]).toContain("'self'");
  });
});

describe("Google One Tap allowlist", () => {
  const credentials = {
    GOOGLE_CLIENT_ID: "123.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "secret",
  };

  test("when enabled, allows the GIS script, styles, service endpoints, and prompt iframe", () => {
    const parsed = directives(
      contentSecurityPolicy({ runtimeEnv: credentials, isDev: false }),
    );
    expect(parsed["script-src"]).toContain(
      "https://accounts.google.com/gsi/client",
    );
    expect(parsed["style-src"]).toContain(
      "https://accounts.google.com/gsi/style",
    );
    expect(parsed["connect-src"]).toContain("https://accounts.google.com/gsi/");
    // Once frame-src is present it replaces the default-src fallback for frames, so it must include
    // 'self': e2e/security-headers.spec.ts relies on a same-origin iframe actually loading in order
    // to see the X-Frame-Options refusal.
    expect(parsed["frame-src"]).toEqual([
      "'self'",
      "https://accounts.google.com/gsi/",
    ]);
  });

  test("without credentials none of them appear, and frame-src isn't sent at all", () => {
    const csp = contentSecurityPolicy({ runtimeEnv: {}, isDev: false });
    expect(csp).not.toContain("accounts.google.com");
    // Not sending it keeps the original policy when disabled (frames keep falling back to
    // default-src 'self').
    expect(directives(csp)["frame-src"]).toBeUndefined();
  });

  test("preview deployments and a client ID alone both count as disabled", () => {
    for (const runtimeEnv of [
      { ...credentials, VERCEL_ENV: "preview" },
      { GOOGLE_CLIENT_ID: credentials.GOOGLE_CLIENT_ID },
    ]) {
      const csp = contentSecurityPolicy({ runtimeEnv, isDev: false });
      expect(csp).not.toContain("accounts.google.com");
      expect(directives(csp)["frame-src"]).toBeUndefined();
    }
  });
});

describe("staticSecurityHeaders", () => {
  test("the four static headers", () => {
    expect(staticSecurityHeaders()).toEqual([
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
      },
    ]);
  });

  test("no HSTS: browsers would remember it before the domain is final (turned on manually in the launch checklist)", () => {
    expect(
      staticSecurityHeaders().map((header) => header.key.toLowerCase()),
    ).not.toContain("strict-transport-security");
  });
});

describe("securityHeaders", () => {
  test("static headers + CSP, with exactly one CSP", () => {
    const headers = securityHeaders({ runtimeEnv: {}, isDev: false });
    expect(
      headers.filter((h) => h.key === "Content-Security-Policy"),
    ).toHaveLength(1);
    expect(headers.map((h) => h.key)).toEqual([
      ...staticSecurityHeaders().map((h) => h.key),
      "Content-Security-Policy",
    ]);
  });
});
