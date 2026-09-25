import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import type { EmailTemplateName } from "./templates";
import { EMAIL_OUTBOX_DIR, type StoredEmail } from "./transports";

export type { StoredEmail };

type EmailFilter = {
  to?: string;
  template?: EmailTemplateName;
  /** 只看这个时间点之后发出的邮件，避免读到上一次测试留下的。 */
  since?: Date;
};

/** 读取 `EMAIL_TRANSPORT=file` 写下的最新一封匹配的邮件；没有时返回 undefined。 */
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

/** 轮询等待一封匹配的邮件，e2e 里提交表单后使用。 */
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

/** 清空发件箱目录。 */
export async function clearEmails(dir = EMAIL_OUTBOX_DIR): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
