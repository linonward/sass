"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Client-side feature flags. The server computes the values with `resolveFlags()` and passes them
 * down through `<FlagsProvider>`: the config used for evaluation lives in `site.config.ts`, and
 * importing it into a client component would drag zod into every page's bundle (see the same
 * tradeoff in `src/core/i18n/locales.ts`), so the client only receives a boolean snapshot.
 *
 * The provider is mounted on `DashboardShell`, covering every signed-in page (product + admin).
 * Public pages that need to branch should use `isEnabled()` on the server; client components that
 * use flags belong on signed-in pages.
 */

const FlagsContext = createContext<Readonly<Record<string, boolean>> | null>(
  null,
);

/** Hands this request's computed flag values to client components. Use it in a server component; values must be plain data. */
export function FlagsProvider({
  values,
  children,
}: {
  values: Readonly<Record<string, boolean>>;
  children: ReactNode;
}) {
  return (
    <FlagsContext.Provider value={values}>{children}</FlagsContext.Provider>
  );
}

/**
 * Reads a flag. Both defaults are false: with no provider (e.g. a public page) or a flag missing from
 * the snapshot (master switch off, or a misspelled name) it doesn't throw and treats the flag as
 * off — flags only take effect when explicitly turned on.
 */
export function useFlag(name: string): boolean {
  return useContext(FlagsContext)?.[name] ?? false;
}

/**
 * Renders based on a flag. When off, renders `fallback` (nothing by default).
 *
 * ```tsx
 * <FeatureFlag name="beta-dashboard" fallback={<OldDashboard />}>
 *   <NewDashboard />
 * </FeatureFlag>
 * ```
 */
export function FeatureFlag({
  name,
  fallback = null,
  children,
}: {
  name: string;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return <>{useFlag(name) ? children : fallback}</>;
}
