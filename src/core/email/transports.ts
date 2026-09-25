import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Resend } from "resend";

import type { EmailTransport } from "./env";

/** 渲染完成、准备交给发送方式的邮件。 */
export type OutgoingEmail = {
  from: string;
  to: string[];
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  template: string;
  locale: string;
  props: Record<string, unknown>;
};

/** `file` 方式写入 `.tmp/emails/` 的 JSON 格式。e2e 依赖它，改动需同步 testing.ts。 */
export type StoredEmail = OutgoingEmail & { id: string; sentAt: string };

export const EMAIL_OUTBOX_DIR = path.join(process.cwd(), ".tmp", "emails");

type Send = (email: OutgoingEmail) => Promise<{ id: string }>;

function consoleTransport(): Send {
  return async (email) => {
    const id = randomUUID();
    console.info(
      [
        "",
        "──────── email (EMAIL_TRANSPORT=console) ────────",
        `To:       ${email.to.join(", ")}`,
        `From:     ${email.from}`,
        `Subject:  ${email.subject}`,
        `Template: ${email.template} (${email.locale})`,
        "",
        email.text,
        "─────────────────────────────────────────────────",
      ].join("\n"),
    );
    return { id };
  };
}

function fileTransport(dir: string): Send {
  return async (email) => {
    const id = randomUUID();
    const sentAt = new Date().toISOString();
    const stored: StoredEmail = { ...email, id, sentAt };
    await mkdir(dir, { recursive: true });
    // 文件名以时间开头，按名字排序即按发送顺序。
    const name = `${sentAt.replace(/[:.]/g, "-")}-${id}.json`;
    await writeFile(path.join(dir, name), JSON.stringify(stored, null, 2));
    return { id };
  };
}

function resendTransport(apiKey: string | undefined): Send {
  if (!apiKey)
    throw new Error("RESEND_API_KEY is required for EMAIL_TRANSPORT=resend");
  const resend = new Resend(apiKey);
  return async (email) => {
    const { data, error } = await resend.emails.send({
      from: email.from,
      to: email.to,
      replyTo: email.replyTo,
      subject: email.subject,
      html: email.html,
      text: email.text,
      tags: [
        { name: "template", value: email.template.replace(/[^\w-]/g, "_") },
      ],
    });
    if (error) {
      throw new Error(
        `Resend failed to send "${email.template}": ${error.message}`,
      );
    }
    return { id: data.id };
  };
}

export function createTransport(
  transport: EmailTransport,
  options: { resendApiKey?: string; outboxDir?: string } = {},
): Send {
  switch (transport) {
    case "resend":
      return resendTransport(options.resendApiKey);
    case "file":
      return fileTransport(options.outboxDir ?? EMAIL_OUTBOX_DIR);
    case "console":
      return consoleTransport();
  }
}
