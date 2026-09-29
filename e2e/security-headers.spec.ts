import { expect, test } from "@playwright/test";

import type { APIResponse } from "@playwright/test";

/**
 * Site-wide security headers (policy and allowlists: see src/core/security/headers.ts).
 * This only pins "are the headers and key directives present"; the exact allowlists are covered by
 * the unit tests in src/core/security/headers.test.ts.
 */
const REQUIRED_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), browsing-topics=()",
};

function expectSecurityHeaders(response: APIResponse, path: string) {
  const headers = response.headers();
  for (const [key, value] of Object.entries(REQUIRED_HEADERS)) {
    expect(headers[key], `${path}: ${key}`).toBe(value);
  }

  const csp = headers["content-security-policy"] ?? "";
  for (const directive of [
    "default-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ]) {
    expect(csp, `CSP on ${path}`).toContain(directive);
  }
  // No newlines in the response header, or the whole CSP becomes invalid.
  expect(csp, `CSP on ${path}`).not.toMatch(/[\r\n]/);

  // The One Tap iframe allowlist: it's only sent when Google sign-in is enabled (client ID
  // configured), so the check is "if present, it must include 'self'". Once frame-src is present it
  // replaces the default-src fallback for frames, and without 'self' even same-origin iframes are
  // blocked — the "/admin can't be embedded in an iframe" case below relies on a same-origin iframe
  // actually loading and then being refused by X-Frame-Options to get its console message.
  const frameSrc = /(?:^|; )frame-src ([^;]+)/.exec(csp)?.[1];
  if (frameSrc) expect(frameSrc, `frame-src on ${path}`).toContain("'self'");

  return csp;
}

test("pages, static files, and the API all carry the site-wide security headers", async ({
  request,
}) => {
  // The home page is rewritten to /en by the proxy; /api and files with extensions are excluded by
  // the proxy matcher and only go through headers() in next.config.ts.
  const cases = [
    { path: "/", status: 200 },
    { path: "/pricing", status: 200 },
    { path: "/blog", status: 200 },
    { path: "/logo.svg", status: 200 },
    { path: "/sitemap.xml", status: 200 },
    { path: "/api/billing/status", status: 401 },
    { path: "/api/nope", status: 404 },
    { path: "/missing.png", status: 404 },
  ];

  for (const { path, status } of cases) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(status);
    expectSecurityHeaders(response, path);
  }
});

test("redirects issued by the proxy carry these headers too", async ({
  request,
}) => {
  // Signed-out visit to /dashboard: src/proxy.ts redirects straight to sign-in based on the cookie.
  const response = await request.get("/dashboard", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers()["location"]).toContain("/sign-in");
  expectSecurityHeaders(response, "/dashboard");
});

test("/admin can't be embedded in an iframe", async ({ page, request }) => {
  const response = await request.get("/admin");
  expectSecurityHeaders(response, "/admin");

  // Actually insert an iframe into the page: the browser should refuse to render it per
  // X-Frame-Options / frame-ancestors and log the refusal to the console.
  await page.goto("/");
  const refused = page.waitForEvent("console", {
    predicate: (message) =>
      /X-Frame-Options|frame-ancestors/i.test(message.text()),
    timeout: 10_000,
  });
  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.src = "/admin";
    document.body.append(frame);
  });
  await refused;
});

test("key pages have no CSP violations", async ({ page }) => {
  // Whatever the CSP blocks may just fail silently (broken images, scripts that don't run), so
  // besides this assertion, also rely on the script-loading assertions in e2e/web-analytics.spec.ts
  // and a manual check in a real browser.
  //
  // Only count lines that mention "Content Security Policy": `Refused to load/execute ...` messages
  // for a MIME mismatch (in a local build /_vercel/insights/script.js 404s as HTML and hits
  // X-Content-Type-Options: nosniff) look the same, but they aren't CSP violations — no allowlist
  // can fix them, and a broad regex would record a build-environment issue as a security-header
  // regression.
  const violations: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && /Content Security Policy/i.test(text)) {
      violations.push(text);
    }
  });

  // Statically prerendered marketing pages, the blog, admin (404), a locale-prefixed path, and
  // sign-in.
  for (const path of [
    "/",
    "/pricing",
    "/blog",
    "/blog/hello-world",
    "/zh",
    "/admin",
    "/sign-in",
  ]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }

  expect(violations, violations.join("\n")).toEqual([]);
});
