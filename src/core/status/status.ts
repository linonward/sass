import type {
  StatusEventSource,
  StatusEventStatus,
} from "@/core/db/schema/status";

/**
 * 状态页的纯计算：当前状态、uptime 和通知合并窗口。
 *
 * 这里刻意不碰数据库 —— 计算部分（尤其是 uptime 的区间重叠）是要单测的，
 * 取数的部分在 ./store.ts。两边的类型都来自下面的 `StatusEvent`。
 */
export type StatusEvent = {
  id: string;
  component: string;
  status: StatusEventStatus;
  message: string;
  source: StatusEventSource;
  createdAt: Date;
  resolvedAt: Date | null;
  notifiedAt: Date | null;
};

export type ComponentStatus = {
  /** 当前影响级别；没有未解决的事件就是 operational。 */
  status: StatusEventStatus;
  /** 当前 incident 的说明；operational 时为 null。 */
  message: string | null;
  /** 当前 incident 的开始时间；operational 时为 null。 */
  since: Date | null;
  incidentId: string | null;
};

/** 整体状态的分档，对应横幅上的三句话。 */
export type OverallStatus = "operational" | "degraded" | "outage";

const OPERATIONAL: ComponentStatus = {
  status: "operational",
  message: null,
  since: null,
  incidentId: null,
};

/**
 * 某个组件的当前状态：**最近的未解决事件**决定。
 *
 * 事件按时间倒序传进来（取数那边已经排好）。`operational` 的事件是「没有影响的公告」，
 * 命中它时同样返回 operational，只是带上说明 —— 这样管理员可以先发通知再升级影响级别。
 */
export function getComponentStatus(events: StatusEvent[]): ComponentStatus {
  const open = events.find((event) => event.resolvedAt === null);
  if (!open) return OPERATIONAL;
  return {
    status: open.status,
    message: open.message,
    since: open.createdAt,
    incidentId: open.id,
  };
}

/** 有 outage 就是 outage，否则有 degraded 就是 degraded，都没有就是 operational。 */
export function overallStatus(statuses: StatusEventStatus[]): OverallStatus {
  if (statuses.includes("outage")) return "outage";
  if (statuses.includes("degraded")) return "degraded";
  return "operational";
}

/**
 * 最近 N 天的 uptime 百分比（0–100）。
 *
 * degraded 和 outage 都算不可用：对访客来说「能登录但很慢」和「登不上」都是「不是全好」，
 * 分成两档会让这个数字多一个没人解释得清的定义。`operational` 的公告不计入。
 *
 * 区间裁剪到窗口内，仍在进行中的事件按 `now` 收尾；多起重叠的 incident 会把总时长
 * 累加到超过窗口，最后按窗口封顶，避免出现负的 uptime。
 */
export function getUptime(
  events: StatusEvent[],
  { now = new Date(), days }: { now?: Date; days: number },
): number {
  const windowMs = days * 86_400_000;
  if (windowMs <= 0) return 100;
  const nowMs = now.getTime();
  const startMs = nowMs - windowMs;

  let downtimeMs = 0;
  for (const event of events) {
    if (event.status === "operational") continue;
    const from = Math.max(event.createdAt.getTime(), startMs);
    const to = Math.min((event.resolvedAt ?? now).getTime(), nowMs);
    if (to > from) downtimeMs += to - from;
  }

  const ratio = 1 - Math.min(downtimeMs, windowMs) / windowMs;
  return Math.max(0, Math.min(100, ratio * 100));
}

/** 同一个 incident 的创建、更新和解决在这个窗口内只发一封通知。 */
export const NOTIFY_MERGE_WINDOW_MS = 5 * 60 * 1000;

/**
 * 这次变更要不要给订阅者发通知。
 *
 * 合并规则落在 incident 行的 `notifiedAt` 上：窗口内已经发过就跳过，下一次真正发出时
 * 把时间往后推。没有订阅者时也会记这一笔 —— 通知是「这次事件在某时刻广播过」，
 * 而不是「有人收到了」。
 */
export function shouldNotify(
  event: Pick<StatusEvent, "notifiedAt">,
  now: Date = new Date(),
  windowMs: number = NOTIFY_MERGE_WINDOW_MS,
): boolean {
  if (!event.notifiedAt) return true;
  return now.getTime() - event.notifiedAt.getTime() >= windowMs;
}

/** 组件已经不在 `statusPage.components` 里了（展示时回退成 key 本身）。 */
export function componentLabel(
  components: Record<string, { label: string }>,
  component: string,
): string {
  return components[component]?.label ?? component;
}
