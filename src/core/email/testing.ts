import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import type { EmailTemplateName } from "./templates";
import { EMAIL_OUTBOX_DIR, type StoredEmail } from "./transports";

export type { StoredEmail };

type EmailFilter = {
  to?: string;
  template?: EmailTemplateName;
  /** Only consider emails sent after this time, so leftovers from a previous test are ignored. */
  since?: Date;
};

/**
 * Reads the latest matching email written by `EMAIL_TRANSPORT=file`; returns undefined when there
 * is none.
 */
export async function readLatestEmail(
  filter: EmailFilter = {},
  dir = EMAIL_OUTBOX_DIR,
): Promise<StoredEmail | undefined> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return undefined;
  }
  for (const file of files.reverse()) {
    const email: StoredEmail = JSON.parse(
      await readFile(path.join(dir, file), "utf8"),
    );
    if (filter.to && !email.to.includes(filter.to)) continue;
    if (filter.template && email.template !== filter.template) continue;
    if (filter.since && new Date(email.sentAt) < filter.since) continue;
    return email;
  }
  return undefined;
}

/** Polls until a matching email arrives; used in e2e after submitting a form. */
export async function waitForEmail(
  filter: EmailFilter = {},
  { timeout = 10_000, interval = 200, dir = EMAIL_OUTBOX_DIR } = {},
): Promise<StoredEmail> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const email = await readLatestEmail(filter, dir);
    if (email) return email;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(
    `No email matching ${JSON.stringify(filter)} within ${timeout}ms`,
  );
}

/** Empties the outbox directory. */
export async function clearEmails(dir = EMAIL_OUTBOX_DIR): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
