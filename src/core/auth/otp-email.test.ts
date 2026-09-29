import { describe, expect, test } from "vitest";

import { otpEmail } from "./otp-email";

const code = "482913";
const expiresInMinutes = 5;

describe("otpEmail", () => {
  test("uses the sign-in-code template for sign-in codes", () => {
    expect(otpEmail({ type: "sign-in", code, expiresInMinutes })).toEqual({
      template: "sign-in-code",
      props: { code, expiresInMinutes },
    });
  });

  test("both change-email codes use change-email-code, with forNewEmail telling recipients apart", () => {
    expect(otpEmail({ type: "change-email", code, expiresInMinutes })).toEqual({
      template: "change-email-code",
      props: { code, expiresInMinutes, forNewEmail: true },
    });
    expect(
      otpEmail({ type: "email-verification", code, expiresInMinutes }),
    ).toEqual({
      template: "change-email-code",
      props: { code, expiresInMinutes, forNewEmail: false },
    });
  });

  test("sends nothing for types that aren't enabled", () => {
    // There is no password sign-in, and email verification codes don't use forget-password.
    expect(otpEmail({ type: "forget-password", code, expiresInMinutes })).toBe(
      null,
    );
    expect(otpEmail({ type: "unknown", code, expiresInMinutes })).toBe(null);
  });
});
