/** A key's status. */
export type ApiKeyStatus = "active" | "revoked" | "expired";

/**
 * The only place validity is decided: the middleware uses it to allow requests, and the UI uses it
 * for status badges. With two separate copies, sooner or later an "expired" key would be allowed on
 * one side and flagged red on the other.
 */
export function apiKeyStatus(
  key: { revokedAt: Date | null; expiresAt: Date | null },
  now = new Date(),
): ApiKeyStatus {
  if (key.revokedAt !== null) return "revoked";
  if (key.expiresAt !== null && key.expiresAt.getTime() <= now.getTime()) {
    return "expired";
  }
  return "active";
}
