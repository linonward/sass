import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const statusEventStatuses = [
  "operational",
  "degraded",
  "outage",
] as const;
export type StatusEventStatus = (typeof statusEventStatuses)[number];

/** 事件来源：管理员在后台开的，还是 auto 模式探测出来的。 */
export const statusEventSources = ["manual", "auto"] as const;
export type StatusEventSource = (typeof statusEventSources)[number];

/**
 * 状态页的一条 incident / 公告。一行就是一条，`resolvedAt` 为 null 表示仍在进行中。
 *
 * - `component` 是 `site.config.ts` 里 `statusPage.components` 的 key；组件后来从配置里
 *   删掉了也不影响历史记录（展示时回退成这个 key 本身）。
 * - `status` 为 `operational` 的行用来发「没有影响的公告」，它不会把整体状态拉成异常。
 * - `notifiedAt` 是最近一次给订阅者发通知的时间，5 分钟内的创建/更新合并成一封
 *   （见 `src/core/status/notify.ts`）。
 */
export const statusEvents = pgTable(
  "status_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    component: text("component").notNull(),
    status: text("status", { enum: statusEventStatuses }).notNull(),
    message: text("message").notNull(),
    source: text("source", { enum: statusEventSources })
      .notNull()
      .default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
  },
  (table) => [
    // 取某个组件的最近一条事件，以及按窗口算 uptime。
    index("status_events_component_idx").on(table.component, table.createdAt),
    // 找「仍在进行中」的事件。
    index("status_events_open_idx").on(table.component, table.resolvedAt),
  ],
);

/**
 * auto 模式的探测状态，每个组件一行。存在的意义是「连续两次失败才 degraded」：
 * 一次探测失败可能只是网络抖动，不该立刻把整体状态拉成异常。
 */
export const statusChecks = pgTable("status_checks", {
  component: text("component").primaryKey(),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull(),
  lastOk: boolean("last_ok"),
  /** 最近一次失败的原因，写进自动创建的 incident 便于排查。 */
  lastError: text("last_error"),
});

/**
 * 状态页的邮件订阅者。双重确认（确认邮件）之后才算订阅，未确认的行到期后可以被重新订阅覆盖。
 *
 * 没有 `userId`：订阅和登录无关，所以不复用 notification_log（那张表的 user_id 是外键）。
 * 也没有退订令牌列：退订链接是「地址 + 站点密钥」的签名，服务端不用记（见 status/subscribers.ts）。
 */
export const statusSubscribers = pgTable(
  "status_subscribers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    /** 订阅时的语言，发通知时用它渲染文案。 */
    locale: text("locale"),
    confirmHash: text("confirm_hash"),
    confirmExpiresAt: timestamp("confirm_expires_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // 一个地址一行；确认令牌的哈希唯一，反查时不必再扫全表。
    uniqueIndex("status_subscribers_email_idx").on(table.email),
    uniqueIndex("status_subscribers_confirm_hash_idx").on(table.confirmHash),
  ],
);
