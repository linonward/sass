import { eq, like, or } from "drizzle-orm";

import { cooldownIdentifier } from "@/core/auth/cooldown";
import { db } from "@/core/db";
import { user, verification } from "@/core/db/schema";

import "./hooks";
import { runOnUserDelete, type DeletedUser } from "./on-user-delete";

/** Escape LIKE wildcards so an `_` in an email doesn't match any character. */
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Delete a user and their data: first run the onUserDelete hooks (abort on failure), then in one
 * transaction delete the verification codes and cooldown records for that email, plus the user
 * itself; session and account rows go through foreign-key cascades. Business tables that
 * reference user.id should set `onDelete: "cascade"`, or register a hook to clean up themselves.
 *
 * This is also where the signed-in state ends: `session.userId` is `onDelete: "cascade"` (see
 * src/core/db/schema/auth.ts), so deleting the user row makes the database delete the sessions
 * too. There is no need to (and you shouldn't) delete sessions manually first — every extra
 * statement in the transaction is one more chance to fail halfway. The auth cookies in the
 * browser are cleared by the caller (deleteAccount in src/core/account/actions.ts).
 */
export async function deleteUserAccount({ userId, email }: DeletedUser) {
  await runOnUserDelete({ userId, email });

  const normalized = email.trim().toLowerCase();
  await db.transaction(async (tx) => {
    await tx.delete(verification).where(
      or(
        // Records from the emailOTP plugin: `<type>-otp-<email>`.
        like(verification.identifier, `%-otp-${escapeLike(normalized)}`),
        eq(verification.identifier, cooldownIdentifier(normalized)),
      ),
    );
    await tx.delete(user).where(eq(user.id, userId));
  });
}
