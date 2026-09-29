/**
 * Neon URLs use the WebSocket driver (which supports interactive transactions); any other Postgres
 * uses node-postgres.
 */
export type DbDriver = "neon" | "pg";

export function driverFor(url: string): DbDriver {
  const { hostname } = new URL(url);
  return hostname === "neon.tech" || hostname.endsWith(".neon.tech")
    ? "neon"
    : "pg";
}
