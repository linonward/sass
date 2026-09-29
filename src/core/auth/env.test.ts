// @vitest-environment node
// t3-env only validates server variables on the server; under jsdom it would count as the client.
import { describe, expect, test } from "vitest";

import { createAppEnv } from "../create-env";
import {
  authServerEnv,
  googleClientId,
  googleCredentials,
  resolveAuthBaseURL,
} from "./env";

const secret = "x".repeat(32);

function check(runtimeEnv: Record<string, string | undefined>) {
  return () => createAppEnv({ server: authServerEnv(runtimeEnv), runtimeEnv });
}

describe("authServerEnv", () => {
  test("fails when BETTER_AUTH_SECRET is missing", () => {
    expect(check({})).toThrow("- BETTER_AUTH_SECRET: ");
  });

  test("fails when BETTER_AUTH_SECRET is too short", () => {
    expect(check({ BETTER_AUTH_SECRET: "short" })).toThrow(
      "- BETTER_AUTH_SECRET: ",
    );
  });

  test("does not require Google credentials locally, in CI, or in previews", () => {
    expect(check({ BETTER_AUTH_SECRET: secret })).not.toThrow();
    expect(
      check({ BETTER_AUTH_SECRET: secret, VERCEL_ENV: "preview" }),
    ).not.toThrow();
  });

  test("fails in Vercel production when Google credentials are missing", () => {
    expect(
      check({ BETTER_AUTH_SECRET: secret, VERCEL_ENV: "production" }),
    ).toThrow("- GOOGLE_CLIENT_ID: ");
  });

  test("edge: an empty BETTER_AUTH_SECRET counts as unset", () => {
    expect(check({ BETTER_AUTH_SECRET: "" })).toThrow("- BETTER_AUTH_SECRET: ");
  });

  test("edge: a secret of exactly 32 characters passes, 31 does not", () => {
    expect(check({ BETTER_AUTH_SECRET: "x".repeat(31) })).toThrow(
      "- BETTER_AUTH_SECRET: ",
    );
    expect(check({ BETTER_AUTH_SECRET: "x".repeat(32) })).not.toThrow();
  });
});

describe("googleCredentials", () => {
  test("disables Google sign-in on preview deployments", () => {
    expect(
      googleCredentials({
        VERCEL_ENV: "preview",
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "s",
      }),
    ).toBeUndefined();
  });

  test("returns credentials only when both values are set", () => {
    expect(googleCredentials({ GOOGLE_CLIENT_ID: "id" })).toBeUndefined();
    expect(
      googleCredentials({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" }),
    ).toEqual({ clientId: "id", clientSecret: "s" });
  });

  test("edge: empty strings count as unset (empty variables in .env are not credentials)", () => {
    expect(
      googleCredentials({ GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" }),
    ).toBeUndefined();
    expect(
      googleCredentials({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "" }),
    ).toBeUndefined();
  });
});

describe("googleClientId", () => {
  test("uses the same check as googleCredentials and returns only the client ID", () => {
    expect(googleClientId({})).toBeUndefined();
    expect(googleClientId({ GOOGLE_CLIENT_ID: "id" })).toBeUndefined();
    expect(
      googleClientId({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" }),
    ).toBe("id");
  });

  test("is also undefined on preview deployments (the page button, One Tap, and CSP all rely on it)", () => {
    expect(
      googleClientId({
        VERCEL_ENV: "preview",
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "s",
      }),
    ).toBeUndefined();
  });
});

describe("resolveAuthBaseURL", () => {
  test("an explicit BETTER_AUTH_URL wins", () => {
    expect(
      resolveAuthBaseURL(
        {
          BETTER_AUTH_URL: "https://auth.example.com",
          VERCEL_ENV: "production",
        },
        "example.com",
      ),
    ).toBe("https://auth.example.com");
  });

  test("production deployment: allows the production domain and falls back to it", () => {
    expect(
      resolveAuthBaseURL(
        {
          VERCEL_ENV: "production",
          VERCEL_PROJECT_PRODUCTION_URL: "example.com",
          VERCEL_URL: "app-abc123-team.vercel.app",
        },
        "example.com",
      ),
    ).toEqual({
      allowedHosts: ["example.com", "app-abc123-team.vercel.app"],
      protocol: "https",
      fallback: "https://example.com",
    });
  });

  test("preview deployment: allows only this deployment's URLs, not all of vercel.app", () => {
    const baseURL = resolveAuthBaseURL(
      {
        VERCEL_ENV: "preview",
        VERCEL_BRANCH_URL: "app-git-feat-team.vercel.app",
        VERCEL_URL: "app-abc123-team.vercel.app",
      },
      "example.com",
    );
    expect(baseURL).toEqual({
      allowedHosts: [
        "example.com",
        "app-git-feat-team.vercel.app",
        "app-abc123-team.vercel.app",
      ],
      protocol: "https",
      fallback: "https://app-git-feat-team.vercel.app",
    });
  });

  test("local: allows localhost on any port", () => {
    expect(resolveAuthBaseURL({}, "example.com")).toEqual({
      allowedHosts: ["localhost:*", "127.0.0.1:*"],
      protocol: "http",
    });
  });

  test("edge: an empty BETTER_AUTH_URL counts as unset and uses dynamic resolution", () => {
    expect(
      resolveAuthBaseURL(
        { BETTER_AUTH_URL: "", VERCEL_ENV: "production" },
        "example.com",
      ),
    ).toEqual({
      allowedHosts: ["example.com"],
      protocol: "https",
      fallback: "https://example.com",
    });
  });

  test("edge: production without VERCEL_URL allows only the production domain, not vercel.app", () => {
    const baseURL = resolveAuthBaseURL(
      {
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "example.com",
      },
      "example.com",
    );
    expect(baseURL).toEqual({
      allowedHosts: ["example.com"],
      protocol: "https",
      fallback: "https://example.com",
    });
  });

  test("edge: dedupes when the domain equals VERCEL_URL", () => {
    expect(
      resolveAuthBaseURL(
        {
          VERCEL_ENV: "production",
          VERCEL_PROJECT_PRODUCTION_URL: "example.com",
          VERCEL_URL: "example.com",
        },
        "example.com",
      ),
    ).toMatchObject({ allowedHosts: ["example.com"] });
  });

  test("edge: a preview without BRANCH_URL falls back to VERCEL_URL", () => {
    expect(
      resolveAuthBaseURL(
        { VERCEL_ENV: "preview", VERCEL_URL: "app-abc123-team.vercel.app" },
        "example.com",
      ),
    ).toEqual({
      allowedHosts: ["example.com", "app-abc123-team.vercel.app"],
      protocol: "https",
      fallback: "https://app-abc123-team.vercel.app",
    });
  });
});
