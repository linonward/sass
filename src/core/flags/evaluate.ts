import { createHash } from "node:crypto";

import type { SiteConfig, UserFlagDefinition } from "@/core/config/schema";

import siteConfig from "../../../site.config";

/**
 * Evaluation of user-facing feature flags. Definitions live in the `userFlags` section of
 * `site.config.ts`. No I/O happens here: given an identity and a flag name, the result is fully
 * deterministic.
 *
 * Evaluation order (see `isEnabledFor`):
 *   1. `userFlags.enabled` off → false (master switch)
 *   2. flag not defined, or `def.enabled` false → false (per-flag switch)
 *   3. `adminOnly` and not an admin → false; admin → true (adminOnly flags aren't bucketed)
 *   4. `rollout <= 0` → false (hard off: a non-adminOnly flag goes to nobody, admins included)
 *   5. admin → true (flags in rollout don't restrict your own team: see it yourself first, then
 *      ramp up)
 *   6. signed out (userId null) → false (no identity, no bucket)
 *   7. `rollout >= 100` → true; otherwise bucket by the first 8 hex digits of
 *      `sha256(userId + flagName)`
 *
 * This module imports `site.config.ts` (which brings in zod), so it is **server-only**.
 * Client-side values are computed on the server and passed in through `<FlagsProvider>`
 * (`src/core/flags/components.tsx`).
 */

export type UserFlagsConfig = SiteConfig["userFlags"];
/** Identity for one evaluation. `userId` null means signed out. */
export type FlagUser = { userId: string | null; isAdmin?: boolean };
/** Flag name + definition, in the order written in config. */
export type NamedFlagDefinition = {
  name: string;
  definition: UserFlagDefinition;
};

/** Whether the master switch is on. When off the whole module goes quiet: evaluation is always false and the admin page 404s. */
export function flagsEnabled(config: UserFlagsConfig = siteConfig.userFlags) {
  return config.enabled;
}

/** All definitions, in config order. Used by the admin list and `<FlagsProvider>`. */
export function flagDefinitions(
  config: UserFlagsConfig = siteConfig.userFlags,
): NamedFlagDefinition[] {
  return Object.entries(config.definitions).map(([name, definition]) => ({
    name,
    definition,
  }));
}

/**
 * Deterministic bucketing: the first 8 hex digits of `sha256(userId + flagName)` map to [0, 1).
 * The same user + flag always lands in the same bucket, so raising the rollout percentage only lets
 * people in and never drops anyone out.
 */
export function flagBucket(userId: string, flagName: string): number {
  const hex = createHash("sha256")
    .update(userId + flagName)
    .digest("hex")
    .slice(0, 8);
  return Number.parseInt(hex, 16) / 0x100000000;
}

/** Evaluates one flag against the given config. Pure function: tests pass in their own `userFlags` section. */
export function isEnabledFor(
  userFlags: UserFlagsConfig,
  user: FlagUser,
  flagName: string,
): boolean {
  if (!userFlags.enabled) return false;
  const def = userFlags.definitions[flagName];
  if (!def?.enabled) return false;
  const isAdmin = user.userId !== null && user.isAdmin === true;
  if (def.adminOnly && !isAdmin) return false;
  // An adminOnly flag is "admins only": admins skip bucketing and see it even with rollout 0.
  if (def.adminOnly) return true;
  // For every other flag, rollout 0 is hard off: nobody gets it (use adminOnly to show it only to
  // your team).
  if (def.rollout <= 0) return false;
  // Flags in rollout don't restrict your own team: see it yourself first, then ramp up by percentage.
  if (isAdmin) return true;
  // Without an identity there's no bucket and no way to check adminOnly, so it's always hidden.
  if (user.userId === null) return false;
  if (def.rollout >= 100) return true;
  return flagBucket(user.userId, flagName) < def.rollout / 100;
}

/**
 * Evaluates one flag against the site config: `isEnabled(userId, "beta-dashboard", { isAdmin })`.
 * Usable directly in server components, Server Actions, and route handlers.
 */
export function isEnabled(
  userId: string | null,
  flagName: string,
  options: { isAdmin?: boolean } = {},
): boolean {
  return isEnabledFor(
    siteConfig.userFlags,
    { userId, isAdmin: options.isAdmin },
    flagName,
  );
}

/**
 * Computes every flag this user can see, for the client's `<FlagsProvider>`.
 * Returns an empty object when the master switch is off: the client gets no keys and `useFlag()`
 * is always false.
 */
export function resolveFlags(
  user: FlagUser,
  config: UserFlagsConfig = siteConfig.userFlags,
): Record<string, boolean> {
  if (!config.enabled) return {};
  return Object.fromEntries(
    flagDefinitions(config).map(({ name }) => [
      name,
      isEnabledFor(config, user, name),
    ]),
  );
}
