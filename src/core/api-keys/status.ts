/** 一把 key 的状态。 */
export type ApiKeyStatus = "active" | "revoked" | "expired";

/**
 * 有效性判定只有这一处：中间件按它放行，界面按它显示状态徽章。
 * 两边各写一套的话，「已过期」迟早会一边放行一边标红。
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
