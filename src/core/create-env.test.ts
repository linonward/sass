// @vitest-environment node
// t3-env only validates server variables on the server; under jsdom it would be treated as the client.
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";
import { z } from "zod";

import { createAppEnv, requiredWhen } from "./create-env";
import {
  emailServerEnv,
  nonResendEmailAllowed,
  resolveEmailTransport,
} from "./email/env";

function aiEnv(ai: boolean, runtimeEnv: Record<string, string | undefined>) {
  return createAppEnv({
    server: { AI_API_KEY: requiredWhen(ai, z.string().min(1)) },
    runtimeEnv,
  });
}

describe("createAppEnv", () => {
  test("throws when the feature is on and the variable is missing, naming the variable", () => {
    expect(() => aiEnv(true, {})).toThrow("- AI_API_KEY: ");
  });

  test("treats an empty string as unset when the feature is on", () => {
    expect(() => aiEnv(true, { AI_API_KEY: "" })).toThrow("- AI_API_KEY: ");
  });

  test("passes when the feature is on and the variable is set", () => {
    expect(aiEnv(true, { AI_API_KEY: "sk-test" }).AI_API_KEY).toBe("sk-test");
  });

  test("no longer requires the variable when the feature is off", () => {
    expect(aiEnv(false, {}).AI_API_KEY).toBeUndefined();
  });

  test("still throws on an invalid value when the feature is off", () => {
    const env = () =>
      createAppEnv({
        server: { AI_TIMEOUT: requiredWhen(false, z.coerce.number()) },
        runtimeEnv: { AI_TIMEOUT: "soon" },
      });
    expect(env).toThrow("- AI_TIMEOUT: ");
  });

  test("throws on an invalid NODE_ENV", () => {
    expect(() => aiEnv(false, { NODE_ENV: "staging" })).toThrow("- NODE_ENV: ");
  });

  test("SKIP_ENV_VALIDATION skips validation (non-production runtime)", () => {
    expect(() => aiEnv(true, { SKIP_ENV_VALIDATION: "1" })).not.toThrow();
    expect(() =>
      aiEnv(true, { NODE_ENV: "development", SKIP_ENV_VALIDATION: "1" }),
    ).not.toThrow();
  });

  // A production runtime (next build / next start / Docker) ignores this switch.
  test("SKIP_ENV_VALIDATION has no effect in a production runtime; missing required vars still throw", () => {
    expect(() =>
      aiEnv(true, { NODE_ENV: "production", SKIP_ENV_VALIDATION: "1" }),
    ).toThrow("- AI_API_KEY: ");
  });

  // The Next CLI fills an unset NODE_ENV with the command's default (`next typegen` uses
  // production; see `process.env.NODE_ENV = process.env.NODE_ENV || defaultEnv` in
  // node_modules/next/dist/bin/next), so "a local command that only sets SKIP_ENV_VALIDATION" is
  // treated as a production runtime — running pnpm typecheck on a clean checkout (no .env.local)
  // would die on the required variables. Setting NODE_ENV=development explicitly in the script is
  // correct; this test locks both variables in place, and removing either turns it red.
  test("typecheck script explicitly sets NODE_ENV=development and skips validation", async () => {
    const pkg = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts.typecheck).toContain("SKIP_ENV_VALIDATION=1");
    expect(pkg.scripts.typecheck).toContain("NODE_ENV=development");
  });

  test("passes validation in a production runtime when all variables are set", () => {
    const env = createAppEnv({
      server: { AI_API_KEY: z.string().min(1) },
      runtimeEnv: {
        NODE_ENV: "production",
        SKIP_ENV_VALIDATION: "1",
        AI_API_KEY: "sk-test",
      },
    });
    expect(env.AI_API_KEY).toBe("sk-test");
  });

  test("client variables are also validated per flag", () => {
    const publicEnv = (enabled: boolean, runtimeEnv: Record<string, string>) =>
      createAppEnv({
        server: {},
        client: { NEXT_PUBLIC_DSN: requiredWhen(enabled, z.url()) },
        runtimeEnv,
      });
    expect(() => publicEnv(true, {})).toThrow("- NEXT_PUBLIC_DSN: ");
    expect(publicEnv(false, {}).NEXT_PUBLIC_DSN).toBeUndefined();
    expect(
      publicEnv(true, { NEXT_PUBLIC_DSN: "https://k@o1.ingest.sentry.io/1" })
        .NEXT_PUBLIC_DSN,
    ).toBe("https://k@o1.ingest.sentry.io/1");
  });
});

describe("email variables", () => {
  function emailEnv(runtimeEnv: Record<string, string | undefined>) {
    return createAppEnv({ server: emailServerEnv(runtimeEnv), runtimeEnv });
  }

  test.each([
    [{}, "console"],
    [{ NODE_ENV: "test" }, "console"],
    [{ NODE_ENV: "production", RESEND_API_KEY: "re_x" }, "resend"],
    // An explicit setting still wins (the default selection logic is unchanged); whether this
    // combination is allowed in production is up to validation — see the cases below.
    [{ NODE_ENV: "production", EMAIL_TRANSPORT: "file" }, "file"],
    [{ EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_x" }, "resend"],
  ])("%o resolves to %s", (runtimeEnv, expected) => {
    expect(resolveEmailTransport(runtimeEnv)).toBe(expected);
  });

  test.each<[Record<string, string | undefined>, boolean]>([
    [{}, true],
    [{ NODE_ENV: "test" }, true],
    [{ NODE_ENV: "development", EMAIL_TRANSPORT: "console" }, true],
    [{ NODE_ENV: "development", EMAIL_TRANSPORT: "file" }, true],
    [{ NODE_ENV: "production", RESEND_API_KEY: "re_x" }, true],
    [{ EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_x" }, true],
    // The rows below are the ones where a production runtime no longer allows console / file.
    [{ NODE_ENV: "production", EMAIL_TRANSPORT: "file" }, false],
    [{ NODE_ENV: "production", EMAIL_TRANSPORT: "console" }, false],
    [{ VERCEL_ENV: "production", EMAIL_TRANSPORT: "file" }, false],
    // The rows above were all true before the rule was tightened.
    // Explicit opt-in (CI runs e2e against a production build): the two rows below stay true.
    [
      {
        NODE_ENV: "production",
        EMAIL_TRANSPORT: "file",
        ALLOW_NON_RESEND_EMAIL: "1",
      },
      true,
    ],
    [
      {
        NODE_ENV: "production",
        EMAIL_TRANSPORT: "console",
        ALLOW_NON_RESEND_EMAIL: "true",
        RESEND_API_KEY: "re_x",
      },
      true,
    ],
  ])("%o passes validation = %s", (runtimeEnv, passes) => {
    const run = () => emailEnv(runtimeEnv);
    if (passes) expect(run).not.toThrow();
    else expect(run).toThrow("- EMAIL_TRANSPORT: ");
  });

  test("console / file fails at startup in a production runtime and names the opt-in switch", () => {
    expect(() =>
      emailEnv({ NODE_ENV: "production", EMAIL_TRANSPORT: "console" }),
    ).toThrow("- EMAIL_TRANSPORT: ");
    expect(() =>
      emailEnv({ NODE_ENV: "production", EMAIL_TRANSPORT: "file" }),
    ).toThrow('must be "resend" in a production runtime');
    // Vercel production counts as production even without NODE_ENV; preview deployments are
    // production builds and likewise only allow resend.
    expect(() =>
      emailEnv({
        VERCEL_ENV: "production",
        EMAIL_TRANSPORT: "file",
        RESEND_API_KEY: "re_x",
      }),
    ).toThrow("- EMAIL_TRANSPORT: ");
    expect(() =>
      emailEnv({
        VERCEL_ENV: "preview",
        NODE_ENV: "production",
        EMAIL_TRANSPORT: "file",
        RESEND_API_KEY: "re_x",
      }),
    ).toThrow("- EMAIL_TRANSPORT: ");
  });

  test("a production runtime allows console / file only with an explicit ALLOW_NON_RESEND_EMAIL=1", () => {
    for (const ALLOW_NON_RESEND_EMAIL of ["1", "true"]) {
      expect(
        emailEnv({
          NODE_ENV: "production",
          EMAIL_TRANSPORT: "file",
          ALLOW_NON_RESEND_EMAIL,
        }).EMAIL_TRANSPORT,
      ).toBe("file");
    }
    // 0 / false is equivalent to unset.
    for (const ALLOW_NON_RESEND_EMAIL of ["0", "false"]) {
      expect(() =>
        emailEnv({
          NODE_ENV: "production",
          EMAIL_TRANSPORT: "file",
          ALLOW_NON_RESEND_EMAIL,
        }),
      ).toThrow("- EMAIL_TRANSPORT: ");
    }
  });

  test("ALLOW_NON_RESEND_EMAIL only accepts 1 / true / 0 / false", () => {
    for (const ALLOW_NON_RESEND_EMAIL of ["1", "true", "0", "false"]) {
      expect(() => emailEnv({ ALLOW_NON_RESEND_EMAIL })).not.toThrow();
    }
    expect(() => emailEnv({ ALLOW_NON_RESEND_EMAIL: "yes" })).toThrow(
      "- ALLOW_NON_RESEND_EMAIL: ",
    );
  });

  // nonResendEmailAllowed truth table: VERCEL_ENV × NODE_ENV × ALLOW_NON_RESEND_EMAIL.
  test.each<[Record<string, string | undefined>, boolean]>([
    [{}, true],
    [{ NODE_ENV: "development" }, true],
    [{ NODE_ENV: "test" }, true],
    [{ VERCEL_ENV: "preview", NODE_ENV: "development" }, true],
    [{ NODE_ENV: "production" }, false],
    [{ VERCEL_ENV: "production" }, false],
    [{ VERCEL_ENV: "production", NODE_ENV: "development" }, false],
    [{ NODE_ENV: "production", ALLOW_NON_RESEND_EMAIL: "1" }, true],
    [{ NODE_ENV: "production", ALLOW_NON_RESEND_EMAIL: "true" }, true],
    [{ NODE_ENV: "production", ALLOW_NON_RESEND_EMAIL: "0" }, false],
    [{ NODE_ENV: "production", ALLOW_NON_RESEND_EMAIL: "false" }, false],
    [{ VERCEL_ENV: "production", ALLOW_NON_RESEND_EMAIL: "1" }, true],
  ])("%o allows a non-resend transport = %s", (runtimeEnv, allowed) => {
    expect(nonResendEmailAllowed(runtimeEnv)).toBe(allowed);
  });

  test("throws in production when RESEND_API_KEY is missing, naming the variable", () => {
    expect(() => emailEnv({ NODE_ENV: "production" })).toThrow(
      "- RESEND_API_KEY: ",
    );
  });

  test("does not require RESEND_API_KEY locally when nothing is set", () => {
    expect(
      emailEnv({ NODE_ENV: "development" }).RESEND_API_KEY,
    ).toBeUndefined();
  });

  test("throws when RESEND_API_KEY is malformed", () => {
    expect(() =>
      emailEnv({ EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "sk-123" }),
    ).toThrow("- RESEND_API_KEY: ");
  });

  test("throws on an invalid EMAIL_TRANSPORT value", () => {
    expect(() => emailEnv({ EMAIL_TRANSPORT: "smtp" })).toThrow(
      "- EMAIL_TRANSPORT: ",
    );
  });
});
