import type { ComponentType } from "react";

import SignInCodeEmail, {
  signInCodeSubject,
  type SignInCodeProps,
} from "./templates/sign-in-code";
import WelcomeEmail, {
  welcomeSubject,
  type WelcomeProps,
} from "./templates/welcome";
import type { EmailT } from "./translator";

type TemplateDefinition<P> = {
  Component: ComponentType<P & { t: EmailT; locale: string }>;
  subject: (t: EmailT, props: P) => string;
};

/** 模板名 → 组件与 props 类型。新增模板时在这里登记，sendEmail 的参数会随之获得类型检查。 */
export const emailTemplates = {
  "sign-in-code": {
    Component: SignInCodeEmail,
    subject: signInCodeSubject,
  } satisfies TemplateDefinition<SignInCodeProps>,
  welcome: {
    Component: WelcomeEmail,
    subject: welcomeSubject,
  } satisfies TemplateDefinition<WelcomeProps>,
};

export type EmailTemplateName = keyof typeof emailTemplates;

export type EmailTemplateProps = {
  "sign-in-code": SignInCodeProps;
  welcome: WelcomeProps;
};

/** 按模板名取定义，props 类型随模板名收窄。 */
export function getEmailTemplate<T extends EmailTemplateName>(
  name: T,
): TemplateDefinition<EmailTemplateProps[T]> {
  return emailTemplates[name] as unknown as TemplateDefinition<
    EmailTemplateProps[T]
  >;
}
