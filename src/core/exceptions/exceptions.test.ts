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

import type { VideoTaskStatus } from "@/core/ai/alibaba-video";
import { createVideoService, VIDEO_TIMEOUT_MS } from "@/core/ai/video";
import type { BillingEvent } from "@/core/billing/events";
import { createGrantCreditsHandler } from "@/core/billing/grant-credits";
import { handleBillingEvent } from "@/core/billing/handle-event";
import {
  registerOnBillingEvent,
  resetOnBillingEvent,
} from "@/core/billing/on-billing-event";
import {
  createReclaimCreditsHandler,
  REFUND_RECLAIM_SOURCE,
} from "@/core/billing/reclaim-credits";
import { FakeProvider } from "@/core/billing/testing/fake-provider";
import { aiConfigSchema } from "@/core/config/schema";
import { createCredits, type Credits } from "@/core/credits/service";
import { createDbClient, type DbClient } from "@/core/db/client";
import {
  adminActions,
  aiUsage,
  billingExceptions,
  creditTransactions,
  orders,
  user,
} from "@/core/db/schema";
import { MemoryStorage } from "@/core/upload/testing";

import { listExceptions } from "./queries";
import { createExceptionService, EXCEPTION_TARGET } from "./service";

// 计费异常台的真库测试。结算类改动对照三处状态：订单（orders）、积分流水
// （credit_transactions，含余额）、异常单（billing_exceptions）；AI 那一侧是 ai_usage。

const url = process.env.DATABASE_URL_TEST;

if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) {
  console.warn("跳过异常台测试：未设置 DATABASE_URL_TEST（见 .env.example）");
}

// site.config.ts 的 lifetime 套餐一次发放 2000 积分。
const GRANTED = 2000;
const ORDER_AMOUNT = 3000;

describe.skipIf(!url)("计费异常台", () => {
  let client: DbClient;
  let db: DbClient["db"];
  let credits: Credits;
  let fake: FakeProvider;
  let userId: string;
  let adminId: string;

  const handle = (event: BillingEvent) => handleBillingEvent(event, { db });

  function useCredits(
    reclaimCredits: Credits["reclaimCredits"] = credits.reclaimCredits,
  ) {
    resetOnBillingEvent();
    registerOnBillingEvent(
      "billing:grant-credits",
      createGrantCreditsHandler({
        enabled: true,
        grantCredits: credits.grantCredits,
      }),
    );
    registerOnBillingEvent(
      "billing:reclaim-credits",
      createReclaimCreditsHandler({ enabled: true, reclaimCredits }),
    );
  }

  /** 一个服务：视频服务按测试给的状态回答。 */
  function service(
    provider = { next: { status: "pending" } as VideoTaskStatus },
  ) {
    const video = {
      recoverVideo: vi.fn(async () => ({ status: "pending" })),
      providerStatus: vi.fn(async () => provider.next),
    };
    return {
      ...createExceptionService({
        db: () => db,
        credits,
        video,
        outbox: { resend: vi.fn(async () => "sent" as const) },
      }),
      video,
      provider,
    };
  }

  async function newUser(prefix: string) {
    const id = `${prefix}-${randomUUID()}`;
    await db.insert(user).values({ id, name: "T", email: `${id}@example.com` });
    return id;
  }

  async function purchase(orderId = `ord_${randomUUID()}`) {
    const event = fake.event("checkout.completed", {
      userId,
      checkoutId: `chk_${randomUUID()}`,
      orderId,
      planId: "lifetime",
      amount: ORDER_AMOUNT,
      currency: "USD",
    });
    expect(await handle(event)).toMatchObject({ status: "processed" });
    return orderId;
  }

  const refund = (
    orderId: string,
    {
      amount = ORDER_AMOUNT,
      refundId = `ref_${randomUUID()}`,
      eventId,
    }: { amount?: number; refundId?: string; eventId?: string } = {},
  ) =>
    fake.event("refund.created", {
      userId,
      orderId,
      refundId,
      amount,
      currency: "USD",
      ...(eventId ? { eventId } : {}),
    });

  /** 花掉积分，让之后的退款回收不够扣。 */
  const spend = (amount: number) =>
    credits.deductCredits({
      userId,
      amount,
      source: "ai",
      sourceId: `call_${randomUUID()}`,
    });

  /** 三处状态：订单、回收流水与余额、异常单。 */
  async function state(orderId: string) {
    const [order] = await db
      .select({
        refundedAmount: orders.refundedAmount,
        status: orders.status,
      })
      .from(orders)
      .where(eq(orders.providerOrderId, orderId));
    const reclaims = await db
      .select({
        amount: creditTransactions.amount,
        sourceId: creditTransactions.sourceId,
      })
      .from(creditTransactions)
      .where(
        and(
          eq(creditTransactions.userId, userId),
          eq(creditTransactions.source, REFUND_RECLAIM_SOURCE),
        ),
      );
    const exceptions = await db
      .select()
      .from(billingExceptions)
      .where(eq(billingExceptions.userId, userId));
    return {
      order: order!,
      reclaims,
      reclaimed: reclaims.reduce((sum, tx) => sum - tx.amount, 0),
      balance: await credits.getBalance(userId),
      exceptions,
    };
  }

  const history = (exceptionId: string) =>
    db
      .select()
      .from(adminActions)
      .where(
        and(
          eq(adminActions.targetKind, EXCEPTION_TARGET),
          eq(adminActions.targetId, exceptionId),
        ),
      );

  beforeAll(async () => {
    const pool = new Pool({ connectionString: url });
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: path.resolve(__dirname, "../../../drizzle"),
    });
    await pool.end();
    client = createDbClient(url!);
    db = client.db;
    credits = createCredits({ db, enabled: true });
    adminId = await newUser("exceptions-admin");
  });

  afterAll(async () => {
    resetOnBillingEvent();
    await client?.close();
  });

  beforeEach(async () => {
    fake = new FakeProvider("secret", `fake-${randomUUID().slice(0, 8)}`);
    userId = await newUser("exceptions-test");
    useCredits();
  });

  test("余额不够时回收产生差额单，和回收在同一事务里；后台列表能看到差额", async () => {
    const orderId = await purchase();
    await spend(1500);

    await handle(refund(orderId));

    const s = await state(orderId);
    expect(s.order.refundedAmount).toBe(ORDER_AMOUNT);
    expect(s.reclaimed).toBe(500);
    expect(s.balance).toBe(0);
    expect(s.exceptions).toHaveLength(1);
    expect(s.exceptions[0]).toMatchObject({
      kind: "refund_reclaim_shortfall",
      status: "open",
      source: REFUND_RECLAIM_SOURCE,
      detail: expect.objectContaining({
        orderId,
        granted: GRANTED,
        owed: GRANTED,
        reclaimed: 500,
        shortfall: 1500,
      }),
    });

    const listed = await listExceptions(db, {
      kind: "refund_reclaim_shortfall",
      status: "open",
    });
    expect(listed.rows.find((row) => row.userId === userId)).toMatchObject({
      detail: expect.objectContaining({ shortfall: 1500 }),
      email: `${userId}@example.com`,
    });
  });

  test("场景 4：回收事务遇到短暂的数据库故障 —— 重放后只回收一次、只退一次、只开一张单", async () => {
    const orderId = await purchase();
    await spend(1500);
    const event = refund(orderId);

    // 第一次处理时回收那一步抛错：整个 webhook 事务回滚，什么都不留下。
    useCredits(async () => {
      throw new Error("connection reset");
    });
    await expect(handle(event)).rejects.toThrow(/billing:reclaim-credits/);
    let s = await state(orderId);
    expect(s.order.refundedAmount).toBe(0);
    expect(s.reclaims).toHaveLength(0);
    expect(s.exceptions).toHaveLength(0);

    // 服务商重推（同一个事件）：这次成功。
    useCredits();
    expect(await handle(event)).toMatchObject({ status: "processed" });
    // 再推一次同一个事件：webhook_events 挡住，三处状态都不变。
    expect(await handle(event)).toEqual({ status: "duplicate" });
    s = await state(orderId);
    expect(s.order.refundedAmount).toBe(ORDER_AMOUNT);
    expect(s.reclaims).toHaveLength(1);
    expect(s.reclaimed).toBe(500);
    expect(s.exceptions).toHaveLength(1);

    // 同一笔退款换事件 ID 重推：回收流水与异常单都由各自的唯一键挡住。
    // （订单上的 refundedAmount 这时会被重复累加 —— 那是订单合并按事件而不是按 refundId
    // 去重的既有问题，不在异常台的范围里；回收按订单金额封顶，积分不受影响。）
    await handle({ ...event, eventId: `evt_${randomUUID()}` });
    s = await state(orderId);
    expect(s.reclaims).toHaveLength(1);
    expect(s.reclaimed).toBe(500);
    expect(s.exceptions).toHaveLength(1);
  });

  test("场景 1：同一退款重复推送、换事件 ID 重推 —— 不产生第二张单", async () => {
    const orderId = await purchase();
    await spend(GRANTED);
    const refundId = `ref_${randomUUID()}`;
    const event = refund(orderId, { refundId });

    await Promise.all([handle(event), handle(event)]);
    await handle(refund(orderId, { refundId, eventId: `evt_${randomUUID()}` }));

    const s = await state(orderId);
    // 余额为 0：一分都扣不动，没有回收流水，但差额单只有一张。
    expect(s.reclaims).toHaveLength(0);
    expect(s.exceptions).toHaveLength(1);
    expect(s.exceptions[0]!.detail).toMatchObject({ shortfall: GRANTED });
  });

  test("重试回收：余额后来够了，扣掉差额并关单，写审计", async () => {
    const orderId = await purchase();
    await spend(1500);
    await handle(refund(orderId));
    const [exception] = (await state(orderId)).exceptions;

    // 用户又买了积分（这里直接发放），余额够还差额了。
    await credits.grantCredits({
      userId,
      amount: 5000,
      source: "test",
      sourceId: randomUUID(),
    });
    const s = service();
    const outcome = await s.retryReclaim({
      actorId: adminId,
      exceptionId: exception!.id,
      reason: "user topped up",
    });
    expect(outcome).toEqual({
      ok: true,
      result: "reclaimed:1500",
      closed: true,
    });

    const after = await state(orderId);
    expect(after.reclaimed).toBe(GRANTED);
    expect(after.balance).toBe(5000 - 1500);
    expect(after.exceptions[0]).toMatchObject({
      status: "resolved",
      resolution: "user topped up",
      attempts: 1,
    });
    expect(after.exceptions[0]!.resolvedAt).not.toBeNull();
    expect(await history(exception!.id)).toEqual([
      expect.objectContaining({
        actorId: adminId,
        action: "retry_reclaim",
        reason: "user topped up",
        result: "reclaimed:1500",
      }),
    ]);

    // 关单之后再点：不做任何事。
    expect(
      await s.retryReclaim({
        actorId: adminId,
        exceptionId: exception!.id,
        reason: "again",
      }),
    ).toEqual({ ok: false, error: "not_open" });
    expect((await state(orderId)).reclaimed).toBe(GRANTED);
  });

  test("重复点击「重试回收」：只扣一次（流水条数与余额）", async () => {
    const orderId = await purchase();
    await spend(1500);
    await handle(refund(orderId));
    const [exception] = (await state(orderId)).exceptions;
    await credits.grantCredits({
      userId,
      amount: 5000,
      source: "test",
      sourceId: randomUUID(),
    });

    const s = service();
    const outcomes = await Promise.all(
      [1, 2, 3].map(() =>
        s.retryReclaim({
          actorId: adminId,
          exceptionId: exception!.id,
          reason: "double click",
        }),
      ),
    );
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.filter((o) => !o.ok)).toEqual([
      { ok: false, error: "not_open" },
      { ok: false, error: "not_open" },
    ]);

    const after = await state(orderId);
    // 原回收 1 条 + 重试 1 条。
    expect(after.reclaims).toHaveLength(2);
    expect(after.reclaimed).toBe(GRANTED);
    expect(after.balance).toBe(5000 - 1500);
    expect(await history(exception!.id)).toHaveLength(1);
  });

  test("重试时余额仍不够：扣能扣的，单子留着，次数和错误累加", async () => {
    const orderId = await purchase();
    await spend(1500);
    await handle(refund(orderId));
    const [exception] = (await state(orderId)).exceptions;
    await credits.grantCredits({
      userId,
      amount: 400,
      source: "test",
      sourceId: randomUUID(),
    });

    const s = service();
    expect(
      await s.retryReclaim({
        actorId: adminId,
        exceptionId: exception!.id,
        reason: "try",
      }),
    ).toEqual({ ok: true, result: "partial:400/1500", closed: false });
    let after = await state(orderId);
    expect(after.reclaimed).toBe(900);
    expect(after.exceptions[0]).toMatchObject({
      status: "open",
      attempts: 1,
      lastError: "balance insufficient: owed 1500, reclaimed 400, balance 0",
      detail: expect.objectContaining({ shortfall: 1100 }),
    });

    // 余额为 0 时再试：一分都扣不动，不写流水。
    expect(
      await s.retryReclaim({
        actorId: adminId,
        exceptionId: exception!.id,
        reason: "try again",
      }),
    ).toEqual({ ok: true, result: "uncollectible:1100", closed: false });
    after = await state(orderId);
    expect(after.reclaims).toHaveLength(2);
    expect(after.exceptions[0]!.attempts).toBe(2);
    expect(await history(exception!.id)).toHaveLength(2);
  });

  test("账上已经不欠了（后来的退款回收已补齐）：重试直接关单，不扣", async () => {
    const orderId = await purchase();
    await spend(1500);
    await handle(refund(orderId, { amount: ORDER_AMOUNT / 2 }));
    const [exception] = (await state(orderId)).exceptions;
    expect(exception!.detail).toMatchObject({ owed: 1000, shortfall: 500 });

    await credits.grantCredits({
      userId,
      amount: 5000,
      source: "test",
      sourceId: randomUUID(),
    });
    // 第二笔退款到达：累计口径下这次把前一次的差额一起收回。
    await handle(refund(orderId, { amount: ORDER_AMOUNT / 2 }));
    expect((await state(orderId)).reclaimed).toBe(GRANTED);

    const outcome = await service().retryReclaim({
      actorId: adminId,
      exceptionId: exception!.id,
      reason: "covered by later refund",
    });
    expect(outcome).toEqual({ ok: true, result: "nothing_owed", closed: true });
    expect((await state(orderId)).reclaimed).toBe(GRANTED);
  });

  test("标记已处理 / 忽略：必须有理由（由 Server Action 校验），写审计，已关的单不能再处理", async () => {
    const orderId = await purchase();
    await spend(GRANTED);
    await handle(refund(orderId));
    const [exception] = (await state(orderId)).exceptions;
    const s = service();

    expect(
      await s.resolve({
        actorId: adminId,
        exceptionId: exception!.id,
        reason: "written off",
        status: "ignored",
      }),
    ).toEqual({ ok: true, result: "ignored", closed: true });
    expect(
      await s.resolve({
        actorId: adminId,
        exceptionId: exception!.id,
        reason: "twice",
        status: "resolved",
      }),
    ).toEqual({ ok: false, error: "not_open" });
    expect((await state(orderId)).exceptions[0]).toMatchObject({
      status: "ignored",
      resolution: "written off",
    });
    expect(await history(exception!.id)).toEqual([
      expect.objectContaining({ action: "ignore", reason: "written off" }),
    ]);
    // 种类不对的动作被拒。
    expect(
      await s.recheck({
        actorId: adminId,
        exceptionId: exception!.id,
        reason: "x",
      }),
    ).toEqual({ ok: false, error: "wrong_kind" });
  });

  test("邮件没发出的单：补发又失败时单子留着并记次数；补发成功才关单；都写审计", async () => {
    const notificationId = randomUUID();
    const [exception] = await db
      .insert(billingExceptions)
      .values({
        kind: "notification_failed",
        userId,
        source: "pending_notifications",
        sourceId: notificationId,
        detail: { template: "payment-succeeded", to: "a@example.com" },
        attempts: 1,
        lastError: "resend 503",
      })
      .returning();
    const resend = vi
      .fn()
      .mockResolvedValueOnce("retry")
      .mockResolvedValueOnce("sent");
    const s = createExceptionService({
      db: () => db,
      credits,
      video: { recoverVideo: vi.fn(), providerStatus: vi.fn() },
      outbox: { resend },
    });
    const input = {
      actorId: adminId,
      exceptionId: exception!.id,
      reason: "provider back up",
    };

    expect(await s.resendNotification(input)).toEqual({
      ok: true,
      result: "retry",
      closed: false,
    });
    let [row] = await db
      .select()
      .from(billingExceptions)
      .where(eq(billingExceptions.id, exception!.id));
    expect(row).toMatchObject({
      status: "open",
      attempts: 2,
      lastError: "resend: retry",
    });

    expect(await s.resendNotification(input)).toEqual({
      ok: true,
      result: "sent",
      closed: true,
    });
    [row] = await db
      .select()
      .from(billingExceptions)
      .where(eq(billingExceptions.id, exception!.id));
    expect(row).toMatchObject({
      status: "resolved",
      resolution: "provider back up",
    });
    expect(resend).toHaveBeenCalledWith(notificationId);
    expect((await history(exception!.id)).map((h) => h.result)).toEqual([
      "retry",
      "sent",
    ]);
    expect(await s.resendNotification(input)).toEqual({
      ok: false,
      error: "not_open",
    });
  });

  describe("AI 任务", () => {
    const config = aiConfigSchema.parse({
      videoModels: [
        {
          id: "t2v",
          provider: "alibaba",
          model: "wan2.7-t2v",
          input: "text",
          creditCost: 20,
        },
      ],
      defaultVideoModel: "t2v",
    });

    function videoSetup() {
      const provider = { next: { status: "pending" } as VideoTaskStatus };
      const clock = { now: Date.now() };
      const client = {
        start: vi.fn(async () => ({ taskId: `task-${randomUUID()}` })),
        status: vi.fn(async () => provider.next),
      };
      const video = createVideoService({
        db,
        config,
        credits,
        checkRateLimit: async () => ({ ok: true, retryAfter: 0 }),
        getClient: () => client,
        getStorage: () => new MemoryStorage(),
        fileUrl: async (key) => key,
        now: () => clock.now,
        logError: vi.fn(),
      });
      return { video, provider, clock, client };
    }

    async function startVideo(v: ReturnType<typeof videoSetup>) {
      await credits.grantCredits({
        userId,
        amount: 100,
        source: "test",
        sourceId: randomUUID(),
      });
      const started = await v.video.startVideo({ userId, prompt: "waves" });
      if (!started.ok) throw new Error(`unexpected ${started.status}`);
      return started.job.id;
    }

    const aiExceptions = () =>
      db
        .select()
        .from(billingExceptions)
        .where(
          and(
            eq(billingExceptions.userId, userId),
            eq(billingExceptions.kind, "ai_job_needs_review"),
          ),
        );

    test("按「服务商没有结果」退款时开单，和退款同一事务；并发结算也只开一张", async () => {
      const v = videoSetup();
      const id = await startVideo(v);
      v.clock.now += VIDEO_TIMEOUT_MS + 1000;
      await Promise.all([
        v.video.pollVideo({ userId, id }),
        v.video.pollVideo({ userId, id }),
        v.video.recoverVideo(id),
      ]);
      const [usage] = await db.select().from(aiUsage).where(eq(aiUsage.id, id));
      expect(usage!.status).toBe("failed");
      expect(await credits.getBalance(userId)).toBe(100);
      const rows = await aiExceptions();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        source: "ai_usage",
        sourceId: id,
        status: "open",
        detail: expect.objectContaining({
          usageId: id,
          refunded: true,
          reason: "timeout: provider returned no result within 30 minutes",
        }),
      });
    });

    test("服务商明确失败的退款不开单", async () => {
      const v = videoSetup();
      const id = await startVideo(v);
      v.provider.next = { status: "failed", error: "FAILED" };
      await v.video.pollVideo({ userId, id });
      expect(await aiExceptions()).toHaveLength(0);
    });

    test("过了出结果时间还查不到服务商状态：开单并累加次数，任务不动", async () => {
      const v = videoSetup();
      const id = await startVideo(v);
      v.client.status.mockRejectedValue(new Error("dashscope 500"));
      // 30 分钟内查不到：暂时性错误，不开单。
      await v.video.recoverVideo(id);
      expect(await aiExceptions()).toHaveLength(0);

      v.clock.now += VIDEO_TIMEOUT_MS + 1000;
      await v.video.recoverVideo(id);
      await v.video.recoverVideo(id);
      const rows = await aiExceptions();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        attempts: 2,
        lastError: "dashscope 500",
        detail: expect.objectContaining({
          reason: "provider task status unavailable",
        }),
      });
      const [usage] = await db.select().from(aiUsage).where(eq(aiUsage.id, id));
      expect(usage!.status).toBe("pending");
    });

    test("重新核对：任务已退款时只记下服务商现在的状态，不动钱，单子留给人判断", async () => {
      const v = videoSetup();
      const id = await startVideo(v);
      v.clock.now += VIDEO_TIMEOUT_MS + 1000;
      await v.video.pollVideo({ userId, id });
      const [exception] = await aiExceptions();

      const s = service({
        next: { status: "succeeded", videoUrl: "https://x.test/v.mp4" },
      });
      const outcome = await s.recheck({
        actorId: adminId,
        exceptionId: exception!.id,
        reason: "user says it finished",
      });
      expect(outcome).toEqual({
        ok: true,
        result: "provider:succeeded",
        closed: false,
      });
      expect(s.video.recoverVideo).not.toHaveBeenCalled();
      const [after] = await aiExceptions();
      expect(after).toMatchObject({
        status: "open",
        attempts: 1,
        lastError: null,
        detail: expect.objectContaining({ providerStatus: "succeeded" }),
      });
      expect(await credits.getBalance(userId)).toBe(100);
      expect(await history(exception!.id)).toEqual([
        expect.objectContaining({
          action: "recheck",
          reason: "user says it finished",
          result: "provider:succeeded",
        }),
      ]);
    });

    test("重新核对：任务还是 pending 时走恢复路径，推进到终态就关单", async () => {
      const v = videoSetup();
      const id = await startVideo(v);
      v.client.status.mockRejectedValue(new Error("dashscope 500"));
      v.clock.now += VIDEO_TIMEOUT_MS + 1000;
      await v.video.recoverVideo(id);
      const [exception] = await aiExceptions();

      const s = service();
      s.video.recoverVideo.mockResolvedValueOnce({ status: "succeeded" });
      expect(
        await s.recheck({
          actorId: adminId,
          exceptionId: exception!.id,
          reason: "provider is back",
        }),
      ).toEqual({ ok: true, result: "recovered:succeeded", closed: true });
      expect(s.video.recoverVideo).toHaveBeenCalledWith(id);
      const [after] = await aiExceptions();
      expect(after).toMatchObject({
        status: "resolved",
        resolution: "provider is back",
      });
    });
  });
});
