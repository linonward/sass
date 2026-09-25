/** Neon 的连接地址走 WebSocket 驱动（支持交互式事务），其他 Postgres 走 node-postgres。 */
export type DbDriver = "neon" | "pg";

export function driverFor(url: string): DbDriver {
  const { hostname } = new URL(url);
  return hostname === "neon.tech" || hostname.endsWith(".neon.tech")
    ? "neon"
    : "pg";
}
