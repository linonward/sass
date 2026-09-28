import { describe, expect, test } from "vitest";

import { otpEmail } from "./otp-email";

const code = "482913";
const expiresInMinutes = 5;

describe("otpEmail", () => {
  test("登录验证码用 sign-in-code 模板", () => {
    expect(otpEmail({ type: "sign-in", code, expiresInMinutes })).toEqual({
      template: "sign-in-code",
      props: { code, expiresInMinutes },
    });
  });

  test("改邮箱的两个验证码都用 change-email-code，靠 forNewEmail 区分收件人", () => {
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

  test("没启用的类型不发信", () => {
    // 本站没有密码登录，邮箱验证码也不走 forget-password。
    expect(otpEmail({ type: "forget-password", code, expiresInMinutes })).toBe(
      null,
    );
    expect(otpEmail({ type: "unknown", code, expiresInMinutes })).toBe(null);
  });
});
