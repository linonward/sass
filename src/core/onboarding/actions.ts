"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { SIGN_IN_PATH } from "@/core/auth/routes";
import { auth } from "@/core/auth/server";
import { db } from "@/core/db";
import { user as userTable } from "@/core/db/schema";
import { localizedPath } from "@/core/seo/urls";

export type CompleteState = { status: "idle" } | { status: "success" };

/**
 * Marks first-run onboarding as done: later sign-ins no longer land on /onboarding automatically,
 * though the page is still reachable from the menu.
 *
 * Only this one boolean is stored — whether each step is done is computed by the page (see
 * steps.ts); storing that too would just give two sources that disagree.
 * Idempotent: repeated clicks, or two tabs clicking at once, just write true again.
 */
export async function completeOnboarding(
  locale: string,
  _prev: CompleteState,
  _form: FormData,
): Promise<CompleteState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(localizedPath(locale, SIGN_IN_PATH));
  await db
    .update(userTable)
    .set({ onboardingCompleted: true })
    .where(eq(userTable.id, session.user.id));
  return { status: "success" };
}
