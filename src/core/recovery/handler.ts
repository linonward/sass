import { timingSafeEqual } from "node:crypto";

/** 常量时间比较：别让逐字节比较的耗时差泄露密钥。 */
function sameSecret(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * `GET /api/cron/recovery`：校验 `Authorization: Bearer <CRON_SECRET>` 后跑一次恢复。
 *
 * - 没设 `CRON_SECRET`：404，入口等于不存在；
 * - 头不对：401；
 * - 头对：跑 `run()`，返回它的汇总。另一个实例正在跑时 `run()` 自己会跳过（租约），
 *   所以平台重复投递、调度器重叠触发都是安全的。
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
