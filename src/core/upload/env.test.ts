// @vitest-environment node
// t3-env validates server variables only on the server; under jsdom it would be treated as the client.
import { describe, expect, test } from "vitest";

import { createAppEnv } from "../create-env";
import { uploadServerEnv } from "./env";

function check(
  runtimeEnv: Record<string, string | undefined>,
  { enabled = true, isPublic = false } = {},
) {
  return () =>
    createAppEnv({
      server: uploadServerEnv(runtimeEnv, { enabled, isPublic }),
      runtimeEnv,
    });
}

const r2 = {
  R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "uploads",
};
const production = { VERCEL_ENV: "production" };

describe("uploadServerEnv", () => {
  test("throws on missing R2 variables in Vercel production with upload enabled", () => {
    for (const name of Object.keys(r2)) {
      expect(check(production)).toThrow(`- ${name}: `);
    }
    expect(check({ ...production, ...r2 })).not.toThrow();
  });

  test("public access also requires R2_PUBLIC_URL, which must be an https origin", () => {
    const env = { ...production, ...r2 };
    expect(check(env, { isPublic: true })).toThrow("- R2_PUBLIC_URL: ");
    expect(
      check(
        { ...env, R2_PUBLIC_URL: "https://files.example.com" },
        { isPublic: true },
      ),
    ).not.toThrow();
    expect(
      check(
        { ...env, R2_PUBLIC_URL: "https://files.example.com/sub" },
        { isPublic: true },
      ),
    ).toThrow("- R2_PUBLIC_URL: ");
    expect(
      check({ ...env, R2_PUBLIC_URL: "http://files.example.com" }),
    ).toThrow("- R2_PUBLIC_URL: ");
  });

  test("nothing is required when upload is off or outside production", () => {
    expect(check(production, { enabled: false })).not.toThrow();
    expect(check({})).not.toThrow();
    expect(check({ VERCEL_ENV: "preview" }, { isPublic: true })).not.toThrow();
  });

  test("throws on a malformed account ID", () => {
    expect(check({ ...r2, R2_ACCOUNT_ID: "abc" })).toThrow("- R2_ACCOUNT_ID: ");
  });
});
