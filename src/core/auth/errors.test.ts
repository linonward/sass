// @vitest-environment node
import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

import { authErrorMessage, EMAIL_SEND_FAILED, RESEND_COOLDOWN } from "./errors";

const read = (name: string) =>
  readFileSync(new URL(name, import.meta.url), "utf8");

/**
 * These two codes are a vocabulary shared by client and server: the server throws them in the
 * APIError's body.code, and sign-in-form.tsx branches on the code to pick the message and the
 * countdown. Renaming one changes the protocol, so both sides must change together.
 */
test("error codes are UPPER_SNAKE_CASE constants the client switches on", () => {
  for (const code of [RESEND_COOLDOWN, EMAIL_SEND_FAILED]) {
    expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
  }
});

test("the two error codes are distinct (a collision would show the wrong message)", () => {
  expect(RESEND_COOLDOWN).not.toBe(EMAIL_SEND_FAILED);
  expect(new Set([RESEND_COOLDOWN, EMAIL_SEND_FAILED]).size).toBe(2);
});

/**
 * Like the one-tap test, this guards bundle size and layering: sign-in-form.tsx is a client
 * component, so as soon as errors.ts imports a server module (env / db / logger), the whole
 * dependency chain ends up in the browser bundle.
 */
test("errors.ts is a leaf module with no imports", () => {
  expect(read("./errors.ts")).not.toMatch(/^\s*import\s/m);
});

test("authErrorMessage maps Better Auth and custom codes to Auth.errors keys", () => {
  const options = { resendCooldown: 60 };
  expect(authErrorMessage({ code: "INVALID_OTP" }, options)).toEqual({
    key: "invalidCode",
  });
  expect(authErrorMessage({ code: "OTP_EXPIRED" }, options)).toEqual({
    key: "codeExpired",
  });
  expect(authErrorMessage({ code: "TOO_MANY_ATTEMPTS" }, options)).toEqual({
    key: "tooManyAttempts",
  });
  expect(authErrorMessage({ code: "BANNED_USER" }, options)).toEqual({
    key: "banned",
  });
  expect(authErrorMessage({ status: 429 }, options)).toEqual({
    key: "rateLimited",
  });
  expect(authErrorMessage({ status: 500 }, options)).toEqual({
    key: "generic",
  });
});

test("authErrorMessage uses the server's retryAfter, else the configured cooldown", () => {
  expect(
    authErrorMessage(
      { code: RESEND_COOLDOWN, retryAfter: 12 },
      { resendCooldown: 60 },
    ),
  ).toEqual({
    key: "cooldown",
    values: { seconds: 12 },
  });
  expect(
    authErrorMessage({ code: RESEND_COOLDOWN }, { resendCooldown: 60 }),
  ).toEqual({
    key: "cooldown",
    values: { seconds: 60 },
  });
});

test("authErrorMessage offers Google only when it is enabled", () => {
  expect(
    authErrorMessage({ code: EMAIL_SEND_FAILED }, { resendCooldown: 60 }),
  ).toEqual({ key: "sendFailed" });
  expect(
    authErrorMessage(
      { code: EMAIL_SEND_FAILED },
      { resendCooldown: 60, googleEnabled: true },
    ),
  ).toEqual({ key: "sendFailedGoogle" });
});
