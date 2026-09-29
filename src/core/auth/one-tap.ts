"use client";

/**
 * Google One Tap: the account prompt shown on the sign-in page; one click on the avatar completes
 * sign-in (no full-page redirect to Google).
 *
 * **Why a separate client instance** instead of adding the plugin to the shared `authClient` in
 * `client.ts`: `createAuthClient`'s plugin list is static at module level, while the client ID is
 * only known by the server at runtime (and preview deployments deliberately disable it, see
 * `googleClientId` in `env.ts`). So the client is created on demand and cached per clientId; the
 * server passes clientId down as a prop, keeping a single site-wide check for "is Google available".
 *
 * This is a client leaf module: **don't import `./env` or `site.config.ts`**, which would drag zod
 * and the config schema into the sign-in page's client bundle (see the comment in
 * `src/core/i18n/locales.ts`).
 */

import { oneTapClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { withLocaleHeader } from "./locale";

function buildClient(clientId: string) {
  return createAuthClient({
    plugins: [
      oneTapClient({
        clientId,
        // `autoSelect` doesn't go here: the plugin takes `auto_select` from the **per-call**
        // options (the plugin-level field never reaches GIS), so silent sign-in is turned off in
        // signInWithOneTap.
        context: "signin",
      }),
    ],
    fetchOptions: { onRequest: withLocaleHeader },
  });
}

let cached: {
  clientId: string;
  client: ReturnType<typeof buildClient>;
} | null = null;

function getClient(clientId: string) {
  if (cached?.clientId !== clientId) {
    cached = { clientId, client: buildClient(clientId) };
  }
  return cached.client;
}

/**
 * Log why the prompt wasn't shown. This is the only diagnostic signal available, and it's printed
 * only in development: the most common cause is that the current origin isn't registered in the
 * Google Cloud Console (`unregistered_origin`), which fails completely silently — no prompt, and no
 * error of any kind.
 */
function logPromptNotification(notification?: unknown) {
  if (process.env.NODE_ENV === "production") return;
  try {
    const reason = (
      notification as { getNotDisplayedReason?: () => string } | undefined
    )?.getNotDisplayedReason?.();
    console.info(
      `[auth] One Tap prompt not displayed${reason ? `: ${reason}` : ""}`,
    );
  } catch {
    // Some notification methods are unavailable under FedCM; if there's no diagnostic, skip it.
  }
}

export type OneTapSignInOptions = {
  /** Google client ID (a public value), passed down once the server decides Google is available. */
  clientId: string;
  /** Same-site URL to go to after a successful sign-in (already sanitized, with locale prefix). */
  callbackURL: string;
  /** Called on failure, to reuse the sign-in page's existing error message. */
  onError: () => void;
};

/**
 * Show the One Tap prompt. The user dismissing it is not a failure — it ends silently, and the
 * page's Google button and email verification code still work as usual.
 */
export async function signInWithOneTap({
  clientId,
  callbackURL,
  onError,
}: OneTapSignInOptions) {
  try {
    await getClient(clientId).oneTap({
      // callbackURL must be passed all the way through: the plugin decides whether to redirect
      // with `(!opts.fetchOptions && !fetchOptions) || opts.callbackURL`, so passing fetchOptions
      // without callbackURL silently skips the redirect — the session is created, but the page
      // stays put with no error.
      callbackURL,
      // Turning off silent sign-in is a hard requirement: sign-out here goes through a Server
      // Action (`actions.ts`), so the FedCM `preventSilentAccess` hook in the better-auth client
      // plugin never fires, and with autoSelect on, the Google session would sign the user right
      // back in after they sign out.
      // It must go here rather than in `oneTapClient({ ... })`: the plugin takes `auto_select`
      // from the per-call options, and the plugin-level field never reaches GIS at all (GIS's own
      // default is also false, but that's a coincidence).
      autoSelect: false,
      fetchOptions: {
        // When the callback fails, the plugin itself just returns silently; this is the only
        // place the error can surface.
        onError,
      },
      onPromptNotification: logPromptNotification,
    });
  } catch {
    // The GIS script failed to load: blocked by CSP, blocked by an ad blocker, or no network. The
    // plugin has already called console.error once.
    //
    // **Don't show an error to the user** here: the script fails to load before the user has done
    // anything (typically an ad blocker blocking accounts.google.com), and a "Google sign-in
    // failed" message would only confuse someone who may have just wanted to use an email
    // verification code. What should be reported is a callback failure after clicking the prompt,
    // and that goes through fetchOptions.onError.
  }
}
