// @vitest-environment node
import { randomUUID } from "node:crypto";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import { createDbClient, type DbClient } from "@/core/db/client";
import {
  billingExceptions,
  notificationLog,
  pendingNotifications,
  user,
} from "@/core/db/schema";

import { claimNotification } from "./notification-log";
import {
  createOutbox,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_SENDING_STALE_MS,
  type OutboxSend,
} from "./outbox";

// outbox 的真库测试：「发出去」以 send 被调用的记录为准（相当于服务商那边的收件记录）。

const url = process.env.DATABASE_URL_TEST;

if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) {
  console.warn("跳过 outbox 测试：未设置 DATABASE_URL_TEST（见 .env.example）");
}

const SECRET = "outbox-test-secret-that-is-long-enough-0123456789";
const HOUR = 60 * 60 * 1000;

describe.skipIf(!url)("事务邮件 outbox", () => {
  let client: DbClient;
  let db: DbClient["db"];
  let userId: string;
  let delivered: {
    to: string;
    template: string;
    props: unknown;
    key?: string;
  }[];
  let down: boolean;
  let clock: { now: number };

  /** 模拟服务商：`down` 时抛错；收到的每一封记下来（带幂等键）。 */
  const send: OutboxSend = async (options, sendOptions) => {
    if (down) throw new Error("resend 503");
    delivered.push({
      to: String(options.to),
      template: options.template,
      props: options.props,
      key: sendOptions.idempotencyKey,
    });
  };

  /** 一个「实例」。进程重启 = 再建一个，数据库还是同一个。 */
  const instance = (sendImpl: OutboxSend = send) =>
    createOutbox({
      db,
      send: sendImpl,
      secret: SECRET,
      retry: { attempts: 1, delayMs: 0 },
      now: () => new Date(clock.now),
      logError: vi.fn(),
    });

  const rows = () =>
    db
      .select()
      .from(pendingNotifications)
      .where(eq(pendingNotifications.userId, userId));

  /** 一封付款成功邮件：和账单 hook 一样，先占去重名额再入队（同一个事务）。 */
  async function enqueuePayment(
    outbox = instance(),
    key = `order:${randomUUID()}`,
  ) {
    const claimedAt = new Date(clock.now);
    return db.transaction(async (tx) => {
      const claimed = await claimNotification(tx, {
        kind: "payment-succeeded",
        key,
        userId,
        windowMs: null,
        now: claimedAt,
      });
      if (!claimed) return null;
      return outbox.enqueue(tx, {
        kind: "payment-succeeded",
        key,
        userId,
        to: `${userId}@example.com`,
        template: "payment-succeeded",
        props: {
          planName: "Pro",
          kind: "one_time",
          paidAt: "2026-09-29T00:00:00Z",
          manageUrl: "https://x.test/billing",
        },
        locale: "en",
        claimedAt,
      });
    });
  }

  beforeAll(async () => {
    const pool = new Pool({ connectionString: url });
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: path.resolve(__dirname, "../../../drizzle"),
    });
    await pool.end();
    client = createDbClient(url!);
    db = client.db;
  });

  afterAll(async () => {
    await client?.close();
  });

  beforeEach(async () => {
    delivered = [];
    down = false;
    clock = { now: Date.now() };
    userId = `outbox-test-${randomUUID()}`;
    await db
      .insert(user)
      .values({ id: userId, name: "T", email: `${userId}@example.com` });
  });

  test("入队后立即发送：一封，带幂等键 notification/<行 id>", async () => {
    const outbox = instance();
    const id = await enqueuePayment(outbox);
    expect(await outbox.deliver(id!)).toBe("sent");
    expect(delivered).toEqual([
      expect.objectContaining({
        template: "payment-succeeded",
        key: `notification/${id}`,
      }),
    ]);
    expect((await rows())[0]).toMatchObject({ status: "sent", attempts: 1 });
    // 已发出的再 deliver 一次：抢不到，不重发。
    expect(await outbox.deliver(id!)).toBe("skipped");
    expect(delivered).toHaveLength(1);
  });

  test("发信服务不可用：记录留在库里；恢复后扫描把它发出去", async () => {
    const outbox = instance();
    down = true;
    const id = await enqueuePayment(outbox);
    expect(await outbox.deliver(id!)).toBe("retry");
    const [pending] = await rows();
    expect(pending).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "resend 503",
    });
    expect(pending!.nextRetryAt.getTime()).toBeGreaterThan(clock.now);

    // 还没到重试时间：扫描不动它。
    down = false;
    expect(await outbox.scan({ userIds: [userId] })).toMatchObject({ due: 0 });
    expect(delivered).toHaveLength(0);

    clock.now += 2 * 60_000;
    expect(await outbox.scan({ userIds: [userId] })).toMatchObject({
      due: 1,
      sent: 1,
    });
    expect(delivered).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ status: "sent", attempts: 2 });
  });

  test("应用重启：旧实例入队、发送失败后消失，新实例的扫描补发", async () => {
    down = true;
    const before = instance();
    const id = await enqueuePayment(before);
    await before.deliver(id!);

    down = false;
    clock.now += HOUR;
    const after = instance();
    await after.scan({ userIds: [userId] });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.key).toBe(`notification/${id}`);
  });

  test("进程在发送中途死掉（卡在 sending）：超时后放回队列，用同一个幂等键再发", async () => {
    const outbox = instance();
    const id = await enqueuePayment(outbox);
    // 模拟：抢到了（sending），还没来得及记结果进程就没了。
    await db
      .update(pendingNotifications)
      .set({ status: "sending", updatedAt: new Date(clock.now) })
      .where(eq(pendingNotifications.id, id!));
    expect(await outbox.scan({ userIds: [userId] })).toMatchObject({
      reset: 0,
      due: 0,
    });

    clock.now += OUTBOX_SENDING_STALE_MS + 1000;
    expect(await outbox.scan({ userIds: [userId] })).toMatchObject({
      reset: 1,
      sent: 1,
    });
    // 服务商那边如果已经收过这一封，同一个键会被认出来 —— 键必须稳定。
    expect(delivered[0]!.key).toBe(`notification/${id}`);
  });

  test("重复扫描、并发扫描与立即发送撞车：同一封只发出一次", async () => {
    const outbox = instance();
    down = true;
    const id = await enqueuePayment(outbox);
    await outbox.deliver(id!);
    down = false;
    clock.now += 2 * 60_000;

    const others = [instance(), instance(), instance()];
    await Promise.all([
      outbox.deliver(id!),
      ...others.map((o) => o.scan({ userIds: [userId] })),
    ]);
    await outbox.scan({ userIds: [userId] });
    expect(delivered).toHaveLength(1);
  });

  test("事件重放：同一 (kind, key) 名额还占着，入不了第二行", async () => {
    const outbox = instance();
    const key = `order:${randomUUID()}`;
    down = true;
    const first = await enqueuePayment(outbox, key);
    await outbox.deliver(first!);
    expect(await enqueuePayment(outbox, key)).toBeNull();
    down = false;
    clock.now += 2 * 60_000;
    await outbox.scan({ userIds: [userId] });
    expect(delivered).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });

  test("重试用完：终态 failed 并保留，释放去重名额，开一张可补发的异常单；人工补发成功", async () => {
    const outbox = instance();
    down = true;
    const key = `order:${randomUUID()}`;
    const id = await enqueuePayment(outbox, key);
    await outbox.deliver(id!);
    for (let i = 1; i < OUTBOX_MAX_ATTEMPTS; i++) {
      clock.now += 5 * HOUR;
      await outbox.scan({ userIds: [userId] });
    }
    const [failed] = await rows();
    expect(failed).toMatchObject({
      status: "failed",
      attempts: OUTBOX_MAX_ATTEMPTS,
      lastError: "resend 503",
    });
    // 再扫也不会无限重试。
    clock.now += 5 * HOUR;
    expect(await outbox.scan({ userIds: [userId] })).toMatchObject({ due: 0 });

    // 名额释放：同一事件之后再触发还能发。
    expect(
      await db
        .select()
        .from(notificationLog)
        .where(
          and(
            eq(notificationLog.kind, "payment-succeeded"),
            eq(notificationLog.key, key),
          ),
        ),
    ).toHaveLength(0);

    // 异常单：后台能看见，指向这一行。
    const [exception] = await db
      .select()
      .from(billingExceptions)
      .where(eq(billingExceptions.userId, userId));
    expect(exception).toMatchObject({
      kind: "notification_failed",
      source: "pending_notifications",
      sourceId: id,
      status: "open",
      lastError: "resend 503",
    });

    // 人工补发：服务恢复后放回队列立即发一次。
    down = false;
    expect(await outbox.resend(id!)).toBe("sent");
    expect(delivered).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ status: "sent", attempts: 1 });
    // 已发出的不能再补发。
    expect(await outbox.resend(id!)).toBe("skipped");
  });

  describe("验证码（敏感参数）", () => {
    async function enqueueCode(outbox = instance(), code = "123456") {
      return outbox.enqueue(db, {
        kind: "sign-in-code",
        key: `sign-in:${userId}@example.com`,
        userId,
        to: `${userId}@example.com`,
        template: "sign-in-code",
        props: { code, expiresInMinutes: 5 },
        locale: "en",
        sensitive: true,
        expiresAt: new Date(clock.now + 5 * 60_000),
        supersede: true,
      });
    }

    test("库里只有密文；发出后原文清掉；邮件里是原来的验证码", async () => {
      const outbox = instance();
      const id = await enqueueCode(outbox, "482913");
      const [stored] = await rows();
      expect(JSON.stringify(stored!.props)).not.toContain("482913");
      expect(stored!.props).toEqual({ enc: expect.any(String) });

      expect(await outbox.deliver(id)).toBe("sent");
      expect(delivered[0]!.props).toEqual({
        code: "482913",
        expiresInMinutes: 5,
      });
      expect((await rows())[0]!.props).toEqual({});
    });

    test("过了有效期还没发出：扫描作废它、清掉原文，不再发，也不开异常单", async () => {
      const outbox = instance();
      down = true;
      const id = await enqueueCode(outbox);
      // 1 分钟后重试仍在 5 分钟有效期内：留着等补发。
      expect(await outbox.deliver(id)).toBe("retry");

      down = false;
      clock.now += 6 * 60_000;
      expect(await outbox.scan({ userIds: [userId] })).toMatchObject({
        expired: 1,
        due: 0,
      });
      expect(delivered).toHaveLength(0);
      const [row] = await rows();
      expect(row).toMatchObject({ status: "failed", props: {} });
      expect(row!.lastError).toContain("expired");
      expect(
        await db
          .select()
          .from(billingExceptions)
          .where(eq(billingExceptions.userId, userId)),
      ).toHaveLength(0);
    });

    test("重新请求验证码：新码取代还没发出的旧码，恢复后只发新码", async () => {
      const outbox = instance();
      down = true;
      const old = await enqueueCode(outbox, "111111");
      await outbox.deliver(old);
      const fresh = await enqueueCode(outbox, "222222");
      await outbox.deliver(fresh);

      const byId = new Map((await rows()).map((r) => [r.id, r]));
      expect(byId.get(old)).toMatchObject({
        status: "failed",
        lastError: "superseded",
        props: {},
      });

      down = false;
      clock.now += 2 * 60_000;
      await outbox.scan({ userIds: [userId] });
      expect(delivered.map((d) => (d.props as { code: string }).code)).toEqual([
        "222222",
      ]);
    });
  });
});
