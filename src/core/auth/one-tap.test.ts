import { readFileSync } from "node:fs";

import { createAuthClient } from "better-auth/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { signInWithOneTap } from "./one-tap";

// Wrap only createAuthClient and use the real implementation for everything else: this lets us count
// how many times it was called (caching) while still testing the real plugin behavior (how GIS is
// initialized and what gets POSTed once a credential arrives).
vi.mock("better-auth/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("better-auth/react")>();
  return { ...actual, createAuthClient: vi.fn(actual.createAuthClient) };
});

const read = (name: string) =>
  readFileSync(new URL(name, import.meta.url), "utf8");

/**
 * Replace GIS with a fake `window.google`: initialize records the config, and prompt immediately
 * acts as if the user clicked their avatar.
 */
function stubGoogle(credential = "fake-id-token") {
  type Config = { callback?: (response: { credential: string }) => void };
  let config: Config = {};

  const prompt = vi.fn(() => {
    config.callback?.({ credential });
  });
  const initialize = vi.fn((next: Config) => {
    config = next;
  });

  (window as unknown as { google: unknown }).google = {
    accounts: { id: { initialize, prompt } },
  };
  // Make the plugin's lazy loader return right away instead of inserting a real <script>: jsdom
  // doesn't load external scripts, so it would hang forever.
  (window as { googleScriptInitialized?: boolean }).googleScriptInitialized =
    true;

  return { initialize, prompt };
}

function stubFetch(status = 400) {
  const fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ message: "invalid id token" }), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as { google?: unknown }).google;
  delete (window as { googleScriptInitialized?: boolean })
    .googleScriptInitialized;
});

/**
 * This guards bundle size: `one-tap.ts` is used by the sign-in page's client component, so as soon
 * as it imports `./env` (zod + t3-env) or `site.config.ts`, the whole config schema lands in the
 * client bundle, adding about 92 KB gzipped for nothing. A regression would otherwise only show up
 * after a build; this makes the unit test fail instead.
 */
describe("one-tap is a client leaf module", () => {
  it("does not import env or config", () => {
    const source = read("./one-tap.ts");
    // Match only real import statements: a comment mentioning env.ts explains why, and must not
    // count as a violation.
    expect(source).not.toMatch(/^\s*import\s[^;]*from\s+"\.\/env"/m);
    expect(source).not.toMatch(/^\s*import\s[^;]*site\.config/m);
    expect(source).not.toMatch(/^\s*import\s[^;]*from\s+"@\/core\/config/m);
  });
});

describe("signInWithOneTap", () => {
  it("initializes with auto_select=false and context=signin, and prompts only once", async () => {
    const { initialize, prompt } = stubGoogle();
    stubFetch();

    await signInWithOneTap({
      clientId: "client-init",
      callbackURL: "/en/dashboard",
      onError: vi.fn(),
    });

    expect(initialize).toHaveBeenCalledTimes(1);
    // Read with ?? []: CI's type check is stricter than local (indexed access includes undefined),
    // and this holds under both settings.
    const [config] = initialize.mock.calls[0] ?? [];
    expect(config).toMatchObject({
      client_id: "client-init",
      // After signing out, the Google session must not silently sign the user back in (sign-out
      // here goes through a Server Action, so the plugin's FedCM preventSilentAccess hook never
      // fires).
      auto_select: false,
      context: "signin",
      ux_mode: "popup",
    });
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("POSTs idToken and callbackURL to /api/auth/one-tap/callback once it has a credential", async () => {
    stubGoogle("token-abc");
    const fetchMock = stubFetch();

    await signInWithOneTap({
      clientId: "client-post",
      callbackURL: "/en/dashboard",
      onError: vi.fn(),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain("/api/auth/one-tap/callback");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      idToken: "token-abc",
      // callbackURL must reach the server: the plugin uses it to decide where to go after sign-in,
      // and without it silently doesn't redirect.
      callbackURL: "/en/dashboard",
    });
  });

  it("passes callback failures to onError (the plugin itself just returns silently)", async () => {
    stubGoogle();
    stubFetch(400);
    const onError = vi.fn();

    await signInWithOneTap({
      clientId: "client-error",
      callbackURL: "/en/dashboard",
      onError,
    });

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("creates the client only once per clientId", async () => {
    stubGoogle();
    stubFetch();
    const createClient = vi.mocked(createAuthClient);
    createClient.mockClear();

    await signInWithOneTap({
      clientId: "client-cached",
      callbackURL: "/en/dashboard",
      onError: vi.fn(),
    });
    await signInWithOneTap({
      clientId: "client-cached",
      callbackURL: "/en/dashboard",
      onError: vi.fn(),
    });

    expect(createClient).toHaveBeenCalledTimes(1);
  });
});
