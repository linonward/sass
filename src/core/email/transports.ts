import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { Resend } from "resend";

import type { EmailTransport } from "./env";

/** A rendered email, ready to hand to a transport. */
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

/**
 * JSON format the `file` transport writes to `.tmp/emails/`. e2e depends on it; keep testing.ts in
 * sync when changing it.
 */
export type StoredEmail = OutgoingEmail & { id: string; sentAt: string };

export const EMAIL_OUTBOX_DIR = path.join(process.cwd(), ".tmp", "emails");

/**
 * Send options. `idempotencyKey`: resending the same email (the same outbox row) carries the same
 * key, so the provider recognizes it and doesn't deliver it twice (Resend keeps keys for 24 hours).
 * console / file ignore it.
 */
export type SendOptions = { idempotencyKey?: string };

type Send = (
  email: OutgoingEmail,
  options?: SendOptions,
) => Promise<{ id: string }>;

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

// In-process counter: emails written within the same millisecond still get file names in send
// order.
let fileSeq = 0;

function fileTransport(dir: string): Send {
  return async (email) => {
    const id = randomUUID();
    const sentAt = new Date().toISOString();
    const stored: StoredEmail = { ...email, id, sentAt };
    await mkdir(dir, { recursive: true });
    // File names are "time-seq-id", so sorting by name sorts by send order.
    const seq = String(fileSeq++ % 1_000_000).padStart(6, "0");
    const name = `${sentAt.replace(/[:.]/g, "-")}-${seq}-${id}.json`;
    // Write a temp file, then rename: e2e polling the outbox in parallel never reads a
    // half-written file.
    const file = path.join(dir, name);
    await writeFile(`${file}.tmp`, JSON.stringify(stored, null, 2));
    await rename(`${file}.tmp`, file);
    return { id };
  };
}

function resendTransport(apiKey: string | undefined): Send {
  if (!apiKey)
    throw new Error("RESEND_API_KEY is required for EMAIL_TRANSPORT=resend");
  const resend = new Resend(apiKey);
  return async (email, options = {}) => {
    const { data, error } = await resend.emails.send(
      {
        from: email.from,
        to: email.to,
        replyTo: email.replyTo,
        subject: email.subject,
        html: email.html,
        text: email.text,
        tags: [
          { name: "template", value: email.template.replace(/[^\w-]/g, "_") },
        ],
      },
      { idempotencyKey: options.idempotencyKey },
    );
    // The same idempotency key was already accepted but the content differs this time (e.g. the
    // template changed between retries): the provider already has this email, so treat it as
    // sent rather than as a failure to retry again.
    if (error?.name === "invalid_idempotent_request") {
      return { id: `idempotent:${options.idempotencyKey}` };
    }
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
