import { createElement, type ComponentType } from "react";
import { render, toPlainText } from "react-email";

import { env } from "@/core/env";

import { resolveEmailTransport, type EmailTransport } from "./env";
import { routing } from "@/core/i18n/routing";

import siteConfig from "../../../site.config";
import {
  getEmailTemplate,
  type EmailTemplateName,
  type EmailTemplateProps,
} from "./templates";
import {
  createTransport,
  type OutgoingEmail,
  type SendOptions,
} from "./transports";
import { emailTranslator, loadMessages } from "./translator";

export type SendEmailOptions<T extends EmailTemplateName> = {
  to: string | string[];
  template: T;
  props: EmailTemplateProps[T];
  /** Recipient's locale, which picks the template copy; defaults to the site's default locale. */
  locale?: string;
};

/** Renders a template (html + plain text) without sending. Shared by sendEmail and tests. */
export async function renderEmail<T extends EmailTemplateName>({
  to,
  template,
  props,
  locale = routing.defaultLocale,
}: SendEmailOptions<T>): Promise<OutgoingEmail> {
  const t = emailTranslator(locale, await loadMessages(locale));
  const definition = getEmailTemplate(template);
  // With a generic template name TS can't match props to the component; SendEmailOptions<T>
  // already constrains the types.
  const Component = definition.Component as unknown as ComponentType<
    Record<string, unknown>
  >;
  const element = createElement(Component, { ...props, t, locale });
  const html = await render(element);
  const { fromName, fromAddress, replyTo } = siteConfig.email;

  return {
    from: `${fromName} <${fromAddress}>`,
    to: Array.isArray(to) ? to : [to],
    replyTo,
    subject: (definition.subject as (t: unknown, p: unknown) => string)(
      t,
      props,
    ),
    html,
    text: toPlainText(html),
    template,
    locale,
    props: props as Record<string, unknown>,
  };
}

/**
 * Sends a transactional email. The transport comes from `EMAIL_TRANSPORT` (see src/core/env.ts):
 * resend sends for real, console prints to the terminal, and file writes to `.tmp/emails/` for e2e
 * to read.
 */
export async function sendEmail<T extends EmailTemplateName>(
  options: SendEmailOptions<T>,
  sendOptions?: SendOptions,
): Promise<{ id: string }> {
  const email = await renderEmail(options);
  const transport = resolveEmailTransport(process.env) as EmailTransport;
  return createTransport(transport, { resendApiKey: env.RESEND_API_KEY })(
    email,
    sendOptions,
  );
}
