"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { localizedPath } from "@/core/seo/urls";

import { SIGN_IN_PATH } from "./routes";
import { auth } from "./server";

/**
 * Sign out and return to the sign-in page. Submitted as a form, so it doesn't depend on client-side
 * JS; the cookies are cleared by the nextCookies plugin.
 */
export async function signOut(locale: string) {
  await auth.api.signOut({ headers: await headers() });
  redirect(localizedPath(locale, SIGN_IN_PATH));
}
