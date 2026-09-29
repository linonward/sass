import { z } from "zod";

// Loaded indirectly by next.config.ts, which doesn't resolve the `@/` alias, so use relative paths.
import { requiredWhen } from "../create-env";

type RuntimeEnv = Record<string, string | undefined>;

/** Whether this is running on Vercel (a production or preview deployment). */
function onVercel(runtimeEnv: RuntimeEnv) {
  return Boolean(runtimeEnv.VERCEL_ENV);
}

/**
 * Variables for the auth module.
 * - `BETTER_AUTH_SECRET` is always required (it signs sessions and encrypts data).
 * - Google credentials are required in Vercel production; locally, in CI, and in previews they can
 *   be omitted, in which case only email verification code sign-in is offered.
 */
export function authServerEnv(runtimeEnv: RuntimeEnv) {
  const production = runtimeEnv.VERCEL_ENV === "production";
  return {
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, "must be at least 32 characters (openssl rand -base64 32)"),
    BETTER_AUTH_URL: z.url().optional(),
    GOOGLE_CLIENT_ID: requiredWhen(production, z.string().min(1)),
    GOOGLE_CLIENT_SECRET: requiredWhen(production, z.string().min(1)),
  };
}

type DynamicBaseURL = {
  allowedHosts: string[];
  protocol: "http" | "https";
  fallback?: string;
};

/**
 * Better Auth's baseURL (it determines the OAuth callback URL and the trusted origins).
 * - When `BETTER_AUTH_URL` is set, use it as-is.
 * - Otherwise resolve it dynamically from the request's Host, but only accept known hosts: the
 *   production domain, this deployment's Vercel URLs (different for every preview), and local
 *   development addresses. Never open up all of *.vercel.app.
 */
export function resolveAuthBaseURL(
  runtimeEnv: RuntimeEnv,
  domain: string,
): string | DynamicBaseURL {
  if (runtimeEnv.BETTER_AUTH_URL) return runtimeEnv.BETTER_AUTH_URL;

  if (onVercel(runtimeEnv)) {
    const hosts = [
      domain,
      runtimeEnv.VERCEL_PROJECT_PRODUCTION_URL,
      runtimeEnv.VERCEL_BRANCH_URL,
      runtimeEnv.VERCEL_URL,
    ].filter((host): host is string => Boolean(host));
    return {
      allowedHosts: [...new Set(hosts)],
      protocol: "https",
      fallback:
        runtimeEnv.VERCEL_ENV === "production"
          ? `https://${domain}`
          : `https://${runtimeEnv.VERCEL_BRANCH_URL ?? runtimeEnv.VERCEL_URL}`,
    };
  }

  return { allowedHosts: ["localhost:*", "127.0.0.1:*"], protocol: "http" };
}

/**
 * Whether Google sign-in is offered: both credentials are set and this is not a Vercel preview
 * deployment. Preview URLs change every time and can't each be registered as a Google callback
 * URL, so previews only offer email verification code sign-in.
 */
export function googleCredentials(runtimeEnv: RuntimeEnv) {
  if (runtimeEnv.VERCEL_ENV === "preview") return undefined;
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } =
    runtimeEnv;
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

/**
 * The **single** source of truth for whether Google sign-in is available: the sign-in page button,
 * the One Tap prompt, and the CSP allowlist all use it. Checking separately would let a preview
 * deployment end up mismatched, with the client showing the prompt while the server has it
 * disabled.
 *
 * Returns only the client ID: it is sent to the browser with the GIS script anyway, while the CSP
 * is a public response header, so the security module should never touch the client secret.
 */
export function googleClientId(runtimeEnv: RuntimeEnv) {
  return googleCredentials(runtimeEnv)?.clientId;
}
