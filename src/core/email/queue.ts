import { getDb } from "@/core/db";
import { env } from "@/core/env";

import { createOutbox } from "./outbox";
import { sendEmail } from "./send";

/**
 * The outbox wired to the global database, real sending, and BETTER_AUTH_SECRET (to encrypt
 * verification codes). Verification code emails and the recovery sweep use it; billing emails and
 * low-balance alerts assemble one the same way in their own hooks.
 */
export const notificationOutbox = createOutbox({
  // Resolve the connection lazily: the database is only needed when actually sending (and tests
  // that mock @/core/db don't blow up at load time).
  db: () => getDb(),
  send: sendEmail,
  secret: env.BETTER_AUTH_SECRET,
});
