import LeadConfirmationEmail, {
  leadConfirmationSubject,
  type LeadConfirmationProps,
} from "./templates/lead-confirmation";
import type { ComponentType } from "react";

import ChangeEmailCodeEmail, {
  changeEmailCodeSubject,
  type ChangeEmailCodeProps,
} from "./templates/change-email-code";
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
import StatusIncidentEmail, {
  statusIncidentSubject,
  type StatusIncidentProps,
} from "./templates/status-incident";
import StatusSubscriptionEmail, {
  statusSubscriptionSubject,
  type StatusSubscriptionProps,
} from "./templates/status-subscription";
import SubscriptionCanceledEmail, {
  subscriptionCanceledSubject,
  type SubscriptionCanceledProps,
} from "./templates/subscription-canceled";
import WelcomeEmail, {
  welcomeSubject,
  type WelcomeProps,
} from "./templates/welcome";
import type { EmailT } from "./translator";
// Templates from feature modules: the component lives in the module's own directory and is
// registered here.
import DownloadReadyEmail, {
  downloadReadySubject,
  type DownloadReadyProps,
} from "@/features/downloads/email";

type TemplateDefinition<P> = {
  Component: ComponentType<P & { t: EmailT; locale: string }>;
  subject: (t: EmailT, props: P) => string;
};

/**
 * Template name → component and props type. Register new templates here and sendEmail's arguments
 * get type-checked accordingly.
 */
export const emailTemplates = {
  "lead-confirmation": {
    Component: LeadConfirmationEmail,
    subject: leadConfirmationSubject,
  } satisfies TemplateDefinition<LeadConfirmationProps>,
  "sign-in-code": {
    Component: SignInCodeEmail,
    subject: signInCodeSubject,
  } satisfies TemplateDefinition<SignInCodeProps>,
  "change-email-code": {
    Component: ChangeEmailCodeEmail,
    subject: changeEmailCodeSubject,
  } satisfies TemplateDefinition<ChangeEmailCodeProps>,
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
  "status-incident": {
    Component: StatusIncidentEmail,
    subject: statusIncidentSubject,
  } satisfies TemplateDefinition<StatusIncidentProps>,
  "status-subscription": {
    Component: StatusSubscriptionEmail,
    subject: statusSubscriptionSubject,
  } satisfies TemplateDefinition<StatusSubscriptionProps>,
  "download-ready": {
    Component: DownloadReadyEmail,
    subject: downloadReadySubject,
  } satisfies TemplateDefinition<DownloadReadyProps>,
};

export type EmailTemplateName = keyof typeof emailTemplates;

export type EmailTemplateProps = {
  "lead-confirmation": LeadConfirmationProps;
  "sign-in-code": SignInCodeProps;
  "change-email-code": ChangeEmailCodeProps;
  welcome: WelcomeProps;
  "payment-succeeded": PaymentSucceededProps;
  "payment-failed": PaymentFailedProps;
  "subscription-canceled": SubscriptionCanceledProps;
  "credits-low": CreditsLowProps;
  "status-incident": StatusIncidentProps;
  "status-subscription": StatusSubscriptionProps;
  "download-ready": DownloadReadyProps;
};

/** Looks up a definition by template name; the props type narrows with the name. */
export function getEmailTemplate<T extends EmailTemplateName>(
  name: T,
): TemplateDefinition<EmailTemplateProps[T]> {
  return emailTemplates[name] as unknown as TemplateDefinition<
    EmailTemplateProps[T]
  >;
}
