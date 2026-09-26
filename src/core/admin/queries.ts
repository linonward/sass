import { count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Database } from "@/core/db/client";
import {
  creditTransactions,
  orders,
  orderStatuses,
  subscriptions,
  subscriptionStatuses,
  user,
  userCredits,
  type OrderStatus,
  type SubscriptionStatus,
} from "@/core/db/schema";

import { ADMIN_PAGE_SIZE } from "./index";

// 后台的只读查询，都在服务端分页。写操作见 ./actions.ts。

export type Paged<T> = {
  rows: T[];
  total: number;
  page: number;
  totalPages: number;
};

/** 解析 ?page=：正整数，其他值按第 1 页。 */
export function parsePage(value: unknown): number {
  const page = Number(typeof value === "string" ? value : undefined);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

/** 解析状态筛选：不在取值范围内时视为不筛选。 */
export function parseStatus<T extends string>(
  value: unknown,
  statuses: readonly T[],
): T | undefined {
  return statuses.includes(value as T) ? (value as T) : undefined;
}

export const parseOrderStatus = (value: unknown) =>
  parseStatus<OrderStatus>(value, orderStatuses);
export const parseSubscriptionStatus = (value: unknown) =>
  parseStatus<SubscriptionStatus>(value, subscriptionStatuses);

/** LIKE 的通配符按字面匹配。 */
function likePattern(query: string) {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function paged<T>(rows: T[], total: number, page: number): Paged<T> {
  return {
    rows,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)),
  };
}

const offsetOf = (page: number) => (page - 1) * ADMIN_PAGE_SIZE;

/** 用户列表：按邮箱或名称搜索（不区分大小写），最新注册的在前。 */
export async function listUsers(
  db: Database,
  { query = "", page = 1 }: { query?: string; page?: number },
) {
  const q = query.trim();
  const where = q
    ? or(ilike(user.email, likePattern(q)), ilike(user.name, likePattern(q)))
    : undefined;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        banned: user.banned,
        createdAt: user.createdAt,
        balance: userCredits.balance,
      })
      .from(user)
      .leftJoin(userCredits, eq(userCredits.userId, user.id))
      .where(where)
      .orderBy(desc(user.createdAt), desc(user.id))
      .limit(ADMIN_PAGE_SIZE)
      .offset(offsetOf(page)),
    db.select({ total: count() }).from(user).where(where),
  ]);
  return paged(rows, total, page);
}

export type AdminUserRow = Awaited<
  ReturnType<typeof listUsers>
>["rows"][number];

const actor = alias(user, "actor");

/** 用户详情：资料、余额、最近 20 条积分流水（含操作者邮箱）、订阅和订单。不存在时为 null。 */
export async function getUserDetail(db: Database, userId: string) {
  // 四个查询都只依赖 userId，一次并发发出；profile 为空时仍然返回 null，
  // 调用方（/admin/users/[id]）据此在流式开始前 notFound()。
  const [[profile], transactions, userSubscriptions, userOrders] =
    await Promise.all([
      db
        .select({
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          banned: user.banned,
          banReason: user.banReason,
          banExpires: user.banExpires,
          emailVerified: user.emailVerified,
          createdAt: user.createdAt,
          balance: userCredits.balance,
        })
        .from(user)
        .leftJoin(userCredits, eq(userCredits.userId, user.id))
        .where(eq(user.id, userId)),
      db
        .select({
          id: creditTransactions.id,
          type: creditTransactions.type,
          amount: creditTransactions.amount,
          reason: creditTransactions.reason,
          source: creditTransactions.source,
          createdAt: creditTransactions.createdAt,
          actorId: creditTransactions.actorId,
          actorEmail: actor.email,
        })
        .from(creditTransactions)
        .leftJoin(actor, eq(actor.id, creditTransactions.actorId))
        .where(eq(creditTransactions.userId, userId))
        .orderBy(
          desc(creditTransactions.createdAt),
          desc(creditTransactions.id),
        )
        .limit(20),
      db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId))
        .orderBy(desc(subscriptions.createdAt)),
      db
        .select()
        .from(orders)
        .where(eq(orders.userId, userId))
        .orderBy(desc(orders.createdAt))
        .limit(20),
    ]);
  if (!profile) return null;

  return {
    ...profile,
    balance: profile.balance ?? 0,
    transactions,
    subscriptions: userSubscriptions,
    orders: userOrders,
  };
}

export type AdminUserDetail = NonNullable<
  Awaited<ReturnType<typeof getUserDetail>>
>;

/** 订单列表，可按状态筛选，最新的在前。 */
export async function listOrders(
  db: Database,
  { status, page = 1 }: { status?: OrderStatus; page?: number },
) {
  const where: SQL | undefined = status ? eq(orders.status, status) : undefined;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: orders.id,
        userId: orders.userId,
        email: user.email,
        provider: orders.provider,
        providerOrderId: orders.providerOrderId,
        planId: orders.planId,
        status: orders.status,
        amount: orders.amount,
        currency: orders.currency,
        refundedAmount: orders.refundedAmount,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .innerJoin(user, eq(user.id, orders.userId))
      .where(where)
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(ADMIN_PAGE_SIZE)
      .offset(offsetOf(page)),
    db.select({ total: count() }).from(orders).where(where),
  ]);
  return paged(rows, total, page);
}

/** 订阅列表，可按状态筛选，最新的在前。 */
export async function listSubscriptions(
  db: Database,
  { status, page = 1 }: { status?: SubscriptionStatus; page?: number },
) {
  const where = status ? eq(subscriptions.status, status) : undefined;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: subscriptions.id,
        userId: subscriptions.userId,
        email: user.email,
        provider: subscriptions.provider,
        providerSubscriptionId: subscriptions.providerSubscriptionId,
        planId: subscriptions.planId,
        status: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        canceledAt: subscriptions.canceledAt,
        createdAt: subscriptions.createdAt,
      })
      .from(subscriptions)
      .innerJoin(user, eq(user.id, subscriptions.userId))
      .where(where)
      .orderBy(desc(subscriptions.createdAt), desc(subscriptions.id))
      .limit(ADMIN_PAGE_SIZE)
      .offset(offsetOf(page)),
    db.select({ total: count() }).from(subscriptions).where(where),
  ]);
  return paged(rows, total, page);
}
