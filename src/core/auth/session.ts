import { headers } from "next/headers";
import { cache } from "react";

import { redirect } from "@/core/i18n/navigation";

import { SIGN_IN_PATH } from "./routes";
import { auth } from "./server";

/** The current request's session; null when signed out. Queried only once per render. */
export const getSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);

/**
 * Call at the top of signed-in pages: redirects to sign-in when there is no valid session. Layout
 * and page render in parallel, so the check in the (app) layout can't guard the page (when the
 * cookie is still there but the session has expired, the page gets null first); every page that
 * uses the session must check it itself.
 */
export async function requirePageSession(locale: string) {
  const session = await getSession();
  if (!session) return redirect({ href: SIGN_IN_PATH, locale });
  return session;
}
