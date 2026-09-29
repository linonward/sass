import { logger, type LogFn } from "@/core/observability/logger";
import { rateLimitResponse, type RateLimitResult } from "@/core/ratelimit";

import { hashApiKey, isApiKeyFormat } from "./generate";
import { apiKeyStatus } from "./status";

/** Identity attached to the request once authentication passes. */
export type ApiKeyContext = {
  userId: string;
  keyId: string;
  name: string;
  prefix: string;
};

/** A database row (revoked / expired ones are returned too; the middleware decides). */
export type ApiKeyLookup = {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export type ApiKeyAuthResult =
  { ok: true; apiKey: ApiKeyContext } | { ok: false; response: Response };

export type ApiKeyMiddlewareDeps = {
  /** `siteConfig.apiKeys.enabled`. When off, every request carrying a key gets a 404. */
  enabled: boolean;
  /** Looks up a key by `hashedKey`; null when not found. */
  findKeyByHash: (hashedKey: string) => Promise<ApiKeyLookup | null>;
  /**
   * Records a usage time. Not part of the auth decision: if it throws we only log it (failing to
   * record a timestamp shouldn't fail the request). No need to wait for it either — the route wraps
   * it in `runAfterResponse`.
   */
  touchLastUsed?: (keyId: string) => Promise<void>;
  /** Per-key rate limit; null means allowed. Omit it for no rate limiting at all. */
  checkRateLimit?: (keyId: string) => Promise<RateLimitResult | null>;
  now?: () => Date;
  logError?: LogFn;
};

/** Extracts the Bearer token from the `Authorization` header; null when not Bearer or empty. */
export function bearerToken(header: string | null) {
  if (!header) return null;
  // Per spec, whitespace around header values is stripped; tolerate it here too (and extra spaces).
  const [scheme, ...rest] = header.trim().split(" ");
  if (scheme?.toLowerCase() !== "bearer") return null;
  return rest.join(" ").trim() || null;
}

function fail(error: "unauthorized" | "not_found", status: 401 | 404) {
  return Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * API key authentication middleware. Not mounted globally in `src/core` — the kit's own routes
 * don't accept keys; API routes that need to identify the calling user opt in to this middleware
 * (see `withApiKey`).
 *
 * Every failure returns the same 401 (bad format, not found, revoked, and expired are
 * indistinguishable), so the caller never learns "this key exists but is no longer valid".
 */
export function createApiKeyMiddleware({
  enabled,
  findKeyByHash,
  touchLastUsed,
  checkRateLimit,
  now = () => new Date(),
  logError = logger.error,
}: ApiKeyMiddlewareDeps) {
  return {
    async authenticate(request: Request): Promise<ApiKeyAuthResult> {
      if (!enabled) return { ok: false, response: fail("not_found", 404) };

      const token = bearerToken(request.headers.get("authorization"));
      if (!token || !isApiKeyFormat(token)) {
        return { ok: false, response: fail("unauthorized", 401) };
      }

      const row = await findKeyByHash(hashApiKey(token));
      if (!row || apiKeyStatus(row, now()) !== "active") {
        return { ok: false, response: fail("unauthorized", 401) };
      }

      if (checkRateLimit) {
        const limited = await checkRateLimit(row.id);
        if (limited && !limited.ok)
          return { ok: false, response: rateLimitResponse(limited) };
      }

      try {
        await touchLastUsed?.(row.id);
      } catch (error) {
        // Failing to record usage doesn't affect this authentication: it's operational info, not
        // a security decision.
        logError("apiKeys.touch_last_used_failed", { error, keyId: row.id });
      }

      return {
        ok: true,
        apiKey: {
          userId: row.userId,
          keyId: row.id,
          name: row.name,
          prefix: row.prefix,
        },
      };
    },
  };
}

/** A request with identity attached: `request.apiKey.userId` / `.keyId`. */
export type ApiKeyRequest = Request & { apiKey: ApiKeyContext };

/**
 * Attaches the auth result to the request, then calls the handler. Use it in a route like this:
 *
 * ```ts
 * export const GET = withApiKey(middleware, (request) =>
 *   Response.json({ userId: request.apiKey.userId }),
 * );
 * ```
 */
export function withApiKey(
  middleware: ReturnType<typeof createApiKeyMiddleware>,
  handler: (request: ApiKeyRequest) => Response | Promise<Response>,
) {
  return async function handleApiKeyRequest(request: Request) {
    const result = await middleware.authenticate(request);
    if (!result.ok) return result.response;
    return handler(Object.assign(request, { apiKey: result.apiKey }));
  };
}
