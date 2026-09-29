import type { EmailTemplateProps } from "@/core/email/templates";

/**
 * A verification code email: the template name and its props. Written as a union so sendEmail can
 * use the discriminant to check that the props match the template name.
 */
export type OtpEmail =
  | { template: "sign-in-code"; props: EmailTemplateProps["sign-in-code"] }
  | {
      template: "change-email-code";
      props: EmailTemplateProps["change-email-code"];
    };

/**
 * Maps the emailOTP plugin's code type to the email to send; null means send nothing.
 *
 * - `sign-in`: sign-in verification code.
 * - `change-email`: in the change-email flow, the code sent to the **new** address (confirms the
 *   new address works).
 * - `email-verification`: in the change-email flow, the code sent to the **current** address
 *   (confirms the owner started the change). Currently only the change-email flow produces it
 *   (`changeEmail.verifyCurrentEmail`); sending a code automatically on sign-up (emailOTP's
 *   `sendVerificationOnSignUp`) is not enabled here — enabling it later needs its own template,
 *   or the copy would say "someone is changing your email".
 * - Other types (`forget-password`, etc.): there is no password sign-in, so send nothing.
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
