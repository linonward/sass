/** The first-run onboarding page (without the locale prefix). */
export const ONBOARDING_PATH = "/onboarding";

/**
 * Where to land after a successful sign-in.
 *
 * Rules (in priority order):
 * 1. The sign-in carried a `callbackURL` (returning to a protected page, an invite link) → always
 *    honor the original target: deep links matter more than onboarding. Passing null as
 *    `onboardingPath` signals this case.
 * 2. The user hasn't finished the checklist (`onboardingCompleted === false`) → onboarding page.
 * 3. Anything else (done, or the field can't be read) → the original target.
 *
 * Users who are done get a redirect byte-for-byte identical to before: one redirect, one load, no
 * flash. A field that can't be read is also treated as "done" — better to skip onboarding once
 * than to keep sending people who already finished it back to the onboarding page.
 *
 * `user` is the user object returned by better-auth; the client doesn't enable
 * `inferAdditionalFields`, so this narrows it here instead of relying on its type.
 */
export function resolvePostSignInPath(input: {
  /** The already-sanitized on-site target (with the locale prefix). */
  callbackURL: string;
  /** This sign-in's onboarding page URL; null for sign-ins that carry a callbackURL. */
  onboardingPath: string | null;
  user: unknown;
}): string {
  if (!input.onboardingPath) return input.callbackURL;
  return onboardingCompleted(input.user) === false
    ? input.onboardingPath
    : input.callbackURL;
}

/** onboardingCompleted on the user object: anything other than a boolean means "unknown". */
function onboardingCompleted(user: unknown): boolean | undefined {
  if (typeof user !== "object" || user === null) return undefined;
  const value = (user as { onboardingCompleted?: unknown }).onboardingCompleted;
  return typeof value === "boolean" ? value : undefined;
}
