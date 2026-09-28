import type { EmailTemplateProps } from "@/core/email/templates";

/**
 * 一个验证码邮件：模板名和它的 props。写成一个联合类型，sendEmail 才能靠判别式检查
 * props 与模板名是否配套。
 */
export type OtpEmail =
  | { template: "sign-in-code"; props: EmailTemplateProps["sign-in-code"] }
  | {
      template: "change-email-code";
      props: EmailTemplateProps["change-email-code"];
    };

/**
 * emailOTP 插件的验证码类型 → 用哪封邮件，返回 null 表示不发信。
 *
 * - `sign-in`：登录验证码。
 * - `change-email`：改邮箱流程里发往**新**地址的验证码（确认新地址可用）。
 * - `email-verification`：改邮箱流程里发往**当前**地址的验证码（确认是本人发起的变更）。
 *   它目前只由改邮箱流程产生（`changeEmail.verifyCurrentEmail`）；注册时自动发验证码
 *   （emailOTP 的 `sendVerificationOnSignUp`）本站没启用 —— 将来要启用的话得给它单独的
 *   模板，否则文案会写成"有人在改邮箱"。
 * - 其它类型（`forget-password` 等）：本站没有密码登录，不发信。
 */
export function otpEmail({
  type,
  code,
  expiresInMinutes,
}: {
  type: string;
  code: string;
  expiresInMinutes: number;
}): OtpEmail | null {
  switch (type) {
    case "sign-in":
      return { template: "sign-in-code", props: { code, expiresInMinutes } };
    case "change-email":
      return {
        template: "change-email-code",
        props: { code, expiresInMinutes, forNewEmail: true },
      };
    case "email-verification":
      return {
        template: "change-email-code",
        props: { code, expiresInMinutes, forNewEmail: false },
      };
    default:
      return null;
  }
}
