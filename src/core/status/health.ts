import { and, eq, inArray, isNull } from "drizzle-orm";

import type { StatusPageConfig, StatusComponent } from "@/core/config/schema";
import type { Database } from "@/core/db/client";
import { statusChecks, statusEvents } from "@/core/db/schema/status";
import { logger } from "@/core/observability/logger";

import { createIncident } from "./store";

/** 单次探测的超时。status page 是自己站在故障现场的页面，不能吊死在一个坏端点上。 */
export const HEALTH_TIMEOUT_MS = 5_000;

/**
 * 连续失败到几次才记为 degraded。一次失败可能只是网络抖动：探针跑在渲染路径上，
 * 上一秒的瞬时抖动不该被写成一条对外可见的 incident。
 */
export const FAILURE_THRESHOLD = 2;

export type ProbeResult =
  { ok: true; status: number } | { ok: false; error: string };

/**
 * 探测一个 health URL：2xx–3xx 算健康，其余（以及超时、网络错误）都算失败。
 *
 * 超时用 `AbortSignal.timeout`，所以探测一定会在 `timeoutMs` 内返回 —— 调用方
 * （`/status` 的渲染）不会被某个不响应的地址拖住。
 */
export async function probeHealth(
  url: string,
  {
    timeoutMs = HEALTH_TIMEOUT_MS,
    fetchImpl = fetch,
  }: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<ProbeResult> {
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "*/*" },
    });
    // 不读 body：健康检查只看状态码，留着不消费的响应会占住连接。
    await response.body?.cancel().catch(() => {});
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    return { ok: true, status: response.status };
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return { ok: false, error: `timeout after ${timeoutMs}ms` };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export type CheckTarget = { component: string; healthUrl: string };

/** 配了 healthUrl 的组件。没配的组件在 auto 模式下仍由管理员手动控制。 */
export function checkTargets(
  components: Record<string, StatusComponent>,
): CheckTarget[] {
  return Object.entries(components).flatMap(([component, config]) =>
    config.healthUrl ? [{ component, healthUrl: config.healthUrl }] : [],
  );
}

function autoIncidentMessage(result: Extract<ProbeResult, { ok: false }>) {
  return `Health check failed: ${result.error}`;
}

/**
 * 这次失败要不要开一条 incident：连续失败到阈值，且当前没有进行中的自动 incident。
 * 抽成纯函数是为了能单测 —— 真正的写入在 `runAutoChecks` 里。
 */
export function shouldOpenIncident(
  failures: number,
  hasOpenAutoIncident: boolean,
): boolean {
  return failures >= FAILURE_THRESHOLD && !hasOpenAutoIncident;
}

/**
 * auto 模式的探测：页面渲染时同步跑一遍（v1 不引入 cron）。
 *
 * 每个组件的记账方式：
 * - 探测成功 → 失败计数清零，并把它**自己**开出来的 incident 解决掉
 *   （`source = "auto"`；管理员手动开的 incident 不会被自动恢复悄悄关掉）；
 * - 探测失败 → 计数 +1，达到 `FAILURE_THRESHOLD` 且当前没有进行中的自动 incident 时，
 *   开一条 degraded。
 *
 * 探测是并行的，写入是逐条串行的 —— 每个组件的两行写入各自独立，没必要为它们开事务。
 */
export async function runAutoChecks(
  db: Database,
  config: Pick<StatusPageConfig, "components">,
  {
    now = new Date(),
    probe = probeHealth,
  }: { now?: Date; probe?: typeof probeHealth } = {},
): Promise<void> {
  const targets = checkTargets(config.components);
  if (targets.length === 0) return;

  const results = await Promise.all(
    targets.map(async ({ component, healthUrl }) => ({
      component,
      result: await probe(healthUrl),
    })),
  );

  const existing = await db
    .select({
      component: statusChecks.component,
      consecutiveFailures: statusChecks.consecutiveFailures,
    })
    .from(statusChecks)
    .where(
      inArray(
        statusChecks.component,
        targets.map((target) => target.component),
      ),
    );
  const previousFailures = new Map(
    existing.map((row) => [row.component, row.consecutiveFailures]),
  );

  for (const { component, result } of results) {
    if (result.ok) {
      await db
        .insert(statusChecks)
        .values({
          component,
          consecutiveFailures: 0,
          lastCheckedAt: now,
          lastOk: true,
          lastError: null,
        })
        .onConflictDoUpdate({
          target: statusChecks.component,
          set: {
            consecutiveFailures: 0,
            lastCheckedAt: now,
            lastOk: true,
            lastError: null,
          },
        });
      await db
        .update(statusEvents)
        .set({ resolvedAt: now })
        .where(
          and(
            eq(statusEvents.component, component),
            eq(statusEvents.source, "auto"),
            isNull(statusEvents.resolvedAt),
          ),
        );
      continue;
    }

    const failures = (previousFailures.get(component) ?? 0) + 1;
    logger.warn("status.health_check_failed", {
      component,
      failures,
      error: result.error,
    });
    await db
      .insert(statusChecks)
      .values({
        component,
        consecutiveFailures: failures,
        lastCheckedAt: now,
        lastOk: false,
        lastError: result.error,
      })
      .onConflictDoUpdate({
        target: statusChecks.component,
        set: {
          consecutiveFailures: failures,
          lastCheckedAt: now,
          lastOk: false,
          lastError: result.error,
        },
      });
    const open = await db
      .select({ id: statusEvents.id })
      .from(statusEvents)
      .where(
        and(
          eq(statusEvents.component, component),
          eq(statusEvents.source, "auto"),
          isNull(statusEvents.resolvedAt),
        ),
      )
      .limit(1);
    if (!shouldOpenIncident(failures, open.length > 0)) continue;

    await createIncident(db, {
      component,
      status: "degraded",
      message: autoIncidentMessage(result),
      source: "auto",
    });
  }
}
