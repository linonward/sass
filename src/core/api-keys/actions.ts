"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { SIGN_IN_PATH } from "@/core/auth/routes";
import { auth } from "@/core/auth/server";
import { getDb } from "@/core/db";
import { localizedPath } from "@/core/seo/urls";

import { createApiKeyService } from "./service";

import siteConfig from "../../../site.config";

export type CreateKeyState =
  | { status: "idle" }
  // The plaintext appears exactly once, in this return value; once the UI shows it, it's gone.
  | { status: "created"; plaintext: string; name: string }
  | { status: "error"; error: "invalid_name" | "duplicate" | "unavailable" };

export type RevokeKeyState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; error: "invalid" | "unavailable" };

// The primary key is a uuid: reject junk values up front instead of passing non-uuid strings to
// Postgres (which throws on them).
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireUserId(locale: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(localizedPath(locale, SIGN_IN_PATH));
  return session.user.id;
}

/** Creates a key and returns its one-time plaintext. */
export async function createApiKey(
  locale: string,
  _prev: CreateKeyState,
  form: FormData,
): Promise<CreateKeyState> {
  // With the module disabled neither the page nor the form exists; check again here so calling the
  // action directly can't create a key.
  if (!siteConfig.apiKeys.enabled) {
    return { status: "error", error: "unavailable" };
  }
  const userId = await requireUserId(locale);
  const name = String(form.get("name") ?? "").trim();
  const result = await createApiKeyService(getDb()).create(userId, name);
  if (!result.ok) return { status: "error", error: result.reason };
  // The list behind the dialog should show the new key right away (actions don't refresh the page
  // on their own, so ask explicitly). Refreshing only re-renders server components; the plaintext
  // in the dialog comes from the action's return value and stays put.
  refresh();
  return {
    status: "created",
    plaintext: result.plaintext,
    name: result.key.name,
  };
}

/**
 * Revokes a key. Idempotent: an already revoked key (or one that isn't yours) also returns
 * success — revoking the same key from two tabs at once shouldn't show an error.
 */
export async function revokeApiKey(
  locale: string,
  _prev: RevokeKeyState,
  form: FormData,
): Promise<RevokeKeyState> {
  if (!siteConfig.apiKeys.enabled) {
    return { status: "error", error: "unavailable" };
  }
  const userId = await requireUserId(locale);
  const keyId = String(form.get("keyId") ?? "");
  if (!UUID_PATTERN.test(keyId)) return { status: "error", error: "invalid" };
  // Return success even when no row changed (already revoked, or the id isn't the current user's):
  // either way the key is unusable, and failing per keyId would only leave the user guessing
  // between two tabs.
  await createApiKeyService(getDb()).revoke(userId, keyId);
  // The status badges in the list are server-rendered, so the page has to re-render once after
  // revoking for the badge to switch to "revoked".
  refresh();
  return { status: "success" };
}
