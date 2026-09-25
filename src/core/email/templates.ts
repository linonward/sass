import type { ComponentType } from "react";

import CreditsLowEmail, {
  creditsLowSubject,
  type CreditsLowProps,
} from "./templates/credits-low";
import PaymentFailedEmail, {
  paymentFailedSubject,
  type PaymentFailedProps,
} from "./templates/payment-failed";
import PaymentSucceededEmail, {
  paymentSucceededSubject,
  type PaymentSucceededProps,
} from "./templates/payment-succeeded";
import SignInCodeEmail, {
  signInCodeSubject,
  type SignInCodeProps,
} from "./templates/sign-in-code";
import SubscriptionCanceledEmail, {
  subscriptionCanceledSubject,
  type SubscriptionCanceledProps,
} from "./templates/subscription-canceled";
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
  "payment-succeeded": {
    Component: PaymentSucceededEmail,
    subject: paymentSucceededSubject,
  } satisfies TemplateDefinition<PaymentSucceededProps>,
  "payment-failed": {
    Component: PaymentFailedEmail,
    subject: paymentFailedSubject,
  } satisfies TemplateDefinition<PaymentFailedProps>,
  "subscription-canceled": {
    Component: SubscriptionCanceledEmail,
    subject: subscriptionCanceledSubject,
  } satisfies TemplateDefinition<SubscriptionCanceledProps>,
  "credits-low": {
    Component: CreditsLowEmail,
    subject: creditsLowSubject,
  } satisfies TemplateDefinition<CreditsLowProps>,
};

export type EmailTemplateName = keyof typeof emailTemplates;

export type EmailTemplateProps = {
  "sign-in-code": SignInCodeProps;
  welcome: WelcomeProps;
  "payment-succeeded": PaymentSucceededProps;
  "payment-failed": PaymentFailedProps;
  "subscription-canceled": SubscriptionCanceledProps;
  "credits-low": CreditsLowProps;
};

/** 按模板名取定义，props 类型随模板名收窄。 */
export function getEmailTemplate<T extends EmailTemplateName>(
  name: T,
): TemplateDefinition<EmailTemplateProps[T]> {
  return emailTemplates[name] as unknown as TemplateDefinition<
    EmailTemplateProps[T]
  >;
}
