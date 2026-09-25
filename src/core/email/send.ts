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
import { createTransport, type OutgoingEmail } from "./transports";
import { emailTranslator, loadMessages } from "./translator";

export type SendEmailOptions<T extends EmailTemplateName> = {
  to: string | string[];
  template: T;
  props: EmailTemplateProps[T];
  /** 收件人的语言，决定模板文案；默认使用站点默认语言。 */
  locale?: string;
};

/** 渲染模板（html + 纯文本），但不发送。sendEmail 和测试共用。 */
export async function renderEmail<T extends EmailTemplateName>({
  to,
  template,
  props,
  locale = routing.defaultLocale,
}: SendEmailOptions<T>): Promise<OutgoingEmail> {
  const t = emailTranslator(locale, await loadMessages(locale));
  const definition = getEmailTemplate(template);
  // 泛型模板名下 TS 无法把 props 与组件对应起来；类型已由 SendEmailOptions<T> 约束。
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
 * 发送事务邮件。发送方式由 `EMAIL_TRANSPORT` 决定（见 src/core/env.ts）：
 * resend 真实发送，console 打印到终端，file 写入 `.tmp/emails/` 供 e2e 读取。
 */
export async function sendEmail<T extends EmailTemplateName>(
  options: SendEmailOptions<T>,
): Promise<{ id: string }> {
  const email = await renderEmail(options);
  const transport = resolveEmailTransport(process.env) as EmailTransport;
  return createTransport(transport, { resendApiKey: env.RESEND_API_KEY })(
    email,
  );
}
