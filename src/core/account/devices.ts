import { auth } from "@/core/auth/server";

import { describeUserAgent, type DeviceLabel } from "./user-agent";

/** One signed-in device as the settings page shows it. Never carries the session token. */
export type Device = {
  id: string;
  label: DeviceLabel;
  ipAddress: string | null;
  createdAt: Date;
  /**
   * When Better Auth last refreshed the session. It only refreshes once per `updateAge` (a day by
   * default), so this is "active around then", not the last request.
   */
  lastActiveAt: Date;
  current: boolean;
  /** Opened by an admin through impersonation, not by the user. */
  impersonated: boolean;
};

type SessionRow = {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  impersonatedBy?: string | null;
};

/**
 * The user's live sessions, newest activity first.
 *
 * Reads through Better Auth's internal adapter rather than the `list-sessions` endpoint: that
 * endpoint only answers for a session created within `freshAge` (a day by default), so it would fail
 * for anyone who signed in yesterday. The adapter is the same read the endpoint does, without the
 * freshness gate, and it respects secondary storage if one is configured.
 */
async function liveSessions(userId: string): Promise<SessionRow[]> {
  const { internalAdapter } = await auth.$context;
  const now = Date.now();
  const rows = (await internalAdapter.listSessions(userId)) as SessionRow[];
  return rows.filter((row) => new Date(row.expiresAt).getTime() > now);
}

export async function listDevices(
  userId: string,
  currentSessionId: string,
): Promise<Device[]> {
  const rows = await liveSessions(userId);
  return rows
    .map((row) => ({
      id: row.id,
      label: describeUserAgent(row.userAgent),
      ipAddress: row.ipAddress ?? null,
      createdAt: new Date(row.createdAt),
      lastActiveAt: new Date(row.updatedAt),
      current: row.id === currentSessionId,
      impersonated: Boolean(row.impersonatedBy),
    }))
    .sort(
      (a, b) =>
        Number(b.current) - Number(a.current) ||
        b.lastActiveAt.getTime() - a.lastActiveAt.getTime(),
    );
}

/** The token of one of the user's own live sessions, looked up by id; undefined otherwise. */
export async function sessionTokenFor(userId: string, sessionId: string) {
  const rows = await liveSessions(userId);
  return rows.find((row) => row.id === sessionId)?.token;
}
