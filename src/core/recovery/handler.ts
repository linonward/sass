import { timingSafeEqual } from "node:crypto";

/** Constant-time comparison: don't let timing differences in a byte-by-byte compare leak the secret. */
function sameSecret(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * `GET /api/cron/recovery`: checks `Authorization: Bearer <CRON_SECRET>`, then runs recovery once.
 *
 * - `CRON_SECRET` not set: 404, as if the endpoint did not exist;
 * - wrong header: 401;
 * - correct header: runs `run()` and returns its summary. If another instance is already running,
 *   `run()` skips on its own (lease), so duplicate platform deliveries and overlapping scheduler
 *   triggers are both safe.
 */
export async function handleCronRecovery<T>(
  request: Request,
  { secret, run }: { secret: string | undefined; run: () => Promise<T> },
): Promise<Response> {
  if (!secret) return Response.json({ error: "not_found" }, { status: 404 });
  const header = request.headers.get("authorization") ?? "";
  if (!sameSecret(header, `Bearer ${secret}`)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await run();
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
