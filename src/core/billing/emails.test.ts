// @vitest-environment node
import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import en from "../../../messages/en.json";
import { createDbClient, type DbClient } from "@/core/db/client";
import { notificationLog, user } from "@/core/db/schema";
import { sendEmail, type SendEmailOptions } from "@/core/email/send";
import { readLatestEmail } from "@/core/email/testing";

import siteConfig from "../../../site.config";
import { createBillingEmailHandler, billingEmailFor } from "./emails";
import { handleBillingEvent } from "./handle-event";
import {
  registerOnBillingEvent,
  resetOnBillingEvent,
} from "./on-billing-event";
import { FakeProvider } from "./testing/fake-provider";
import { processWebhook } from "./webhook";

// 模拟多语言站点，第二门语言的文案由 en.json 伪翻译而来。
vi.mock("@/core/i18n/routing", () => ({
  routing: { locales: ["en", "de"], defaultLocale: "en" },
}));

function pseudo(value: unknown): unknown {
  if (typeof value === "string") return `[de] ${value}`;
  return Object.fromEntries(
    Object.entries(value as object).map(([k, v]) => [k, pseudo(v)]),
  );
}

vi.mock("@/core/email/translator", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/core/email/translator")>();
  return {
    ...actual,
    loadMessages: async (locale: string) =>
      locale === "de" ? pseudo(en) : actual.loadMessages(locale),
  };
});

const url = process.env.DATABASE_URL_TEST;
if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) console.warn("跳过账单邮件测试：未设置 DATABASE_URL_TEST");

type Sent = SendEmailOptions<
  "payment-succeeded" | "payment-failed" | "subscription-canceled"
>;

describe("billingEmailFor 触发映射", () => {
  const fake = new FakeProvider();
  test.each([
    [
      "一次性购买",
      fake.event("checkout.completed", {
        checkoutId: "c",
        orderId: "ord_1",
        planId: "lifetime",
      }),
      "payment-succeeded",
    ],
    [
      "订阅结账（由续费事件负责）",
      fake.event("checkout.completed", {
        checkoutId: "c",
        orderId: "ord_1",
        subscriptionId: "sub_1",
      }),
      null,
    ],
    [
      "订阅续费",
      fake.event("subscription.renewed", { subscriptionId: "sub_1" }),
      "payment-succeeded",
    ],
    [
      "付款失败",
      fake.event("payment.failed", { subscriptionId: "sub_1" }),
      "payment-failed",
    ],
    [
      "订阅取消",
      fake.event("subscription.canceled", { subscriptionId: "sub_1" }),
      "subscription-canceled",
    ],
    [
      "订阅激活",
      fake.event("subscription.active", { subscriptionId: "sub_1" }),
      null,
    ],
    [
      "订阅过期",
      fake.event("subscription.expired", { subscriptionId: "sub_1" }),
      null,
    ],
    [
      "退款",
      fake.event("refund.created", {
        orderId: "ord_1",
        refundId: "ref_1",
        amount: 100,
        currency: "USD",
      }),
      null,
    ],
  ] as const)("%s", (_, event, template) => {
    expect(billingEmailFor(event, { stale: false })?.template ?? null).toBe(
      template,
    );
  });

  test("旧事件：付款成功照发，付款失败和取消不发", () => {
    expect(
      billingEmailFor(
        fake.event("subscription.renewed", { subscriptionId: "s" }),
        { stale: true },
      )?.template,
    ).toBe("payment-succeeded");
    expect(
      billingEmailFor(fake.event("payment.failed", { subscriptionId: "s" }), {
        stale: true,
      }),
    ).toBeNull();
    expect(
      billingEmailFor(
        fake.event("subscription.canceled", { subscriptionId: "s" }),
        { stale: true },
      ),
    ).toBeNull();
  });
});

describe.skipIf(!url)("账单邮件（真实 Postgres）", () => {
  let client: DbClient;
  let db: DbClient["db"];
  let userId: string;
  let email: string;
  let fake: FakeProvider;
  const sent: Sent[] = [];
  let failSend = false;

  const capture = async (message: Sent) => {
    if (failSend) throw new Error("SMTP down");
    sent.push(message);
  };

  function useHandler(send: typeof capture | typeof sendEmail = capture) {
    resetOnBillingEvent();
    registerOnBillingEvent(
      "billing:emails",
      createBillingEmailHandler({
        send: send as never,
        creditsEnabled: true,
      }),
    );
  }

  const handle = (event: Parameters<typeof handleBillingEvent>[0]) =>
    handleBillingEvent(event, { db });

  const period = (start: string) => ({
    currentPeriodStart: new Date(start),
    currentPeriodEnd: new Date(
      new Date(start).getTime() + 30 * 24 * 3600 * 1000,
    ),
  });

  beforeAll(() => {
    client = createDbClient(url!);
    db = client.db;
  });
  afterAll(async () => {
    resetOnBillingEvent();
    await client?.close();
  });

  beforeEach(async () => {
    sent.length = 0;
    failSend = false;
    fake = new FakeProvider();
    userId = `u_${randomUUID()}`;
    email = `billing-${randomUUID().slice(0, 8)}@example.com`;
    await db.insert(user).values({
      id: userId,
      name: "Ada",
      email,
      emailVerified: true,
      locale: "de",
    });
    useHandler();
  });

  test("一次性购买：发一封 payment-succeeded，按用户语言、带金额和积分", async () => {
    await handle(
      fake.event("checkout.completed", {
        userId,
        checkoutId: "chk",
        orderId: `ord_${randomUUID()}`,
        planId: "lifetime",
        amount: 19900,
        currency: "USD",
      }),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: email,
      locale: "de",
      template: "payment-succeeded",
      props: {
        planName: "[de] Lifetime",
        kind: "one_time",
        amount: 19900,
        currency: "USD",
        credits: 2000,
        manageUrl: `https://${siteConfig.domain}/de/billing`,
      },
    });
  });

  test("订阅首期：结账完成和首期付款两个事件只发一封", async () => {
    const sub = `sub_${randomUUID()}`;
    await handle(
      fake.event("checkout.completed", {
        userId,
        checkoutId: "chk",
        orderId: `ord_${randomUUID()}`,
        subscriptionId: sub,
        planId: "pro",
      }),
    );
    await handle(
      fake.event("subscription.renewed", {
        userId,
        subscriptionId: sub,
        planId: "pro",
        orderId: `tran_${randomUUID()}`,
        ...period("2026-09-25T00:00:00.000Z"),
      }),
    );
    expect(sent.map((m) => m.template)).toEqual(["payment-succeeded"]);
    expect(sent[0].props).toMatchObject({
      kind: "subscription",
      planName: "[de] Pro",
      // 事件没带金额时用套餐标价。
      amount: 1900,
      currency: "USD",
      renewsAt: "2026-10-25T00:00:00.000Z",
    });
  });

  test("同一笔付款换了事件 ID 再推一次，不重复发信", async () => {
    const sub = `sub_${randomUUID()}`;
    const fields = {
      userId,
      subscriptionId: sub,
      planId: "pro",
      ...period("2026-09-25T00:00:00.000Z"),
    };
    await handle(fake.event("subscription.renewed", fields));
    await handle(fake.event("subscription.renewed", fields));
    expect(sent).toHaveLength(1);
  });

  test("同一事件重复投递：第二次是 duplicate，不再发信", async () => {
    const event = fake.event("payment.failed", {
      userId,
      subscriptionId: `sub_${randomUUID()}`,
      amount: 1900,
      currency: "USD",
    });
    expect((await handle(event)).status).toBe("processed");
    expect((await handle(event)).status).toBe("duplicate");
    expect(sent.map((m) => m.template)).toEqual(["payment-failed"]);
  });

  test("下一个账期的续费会再发一封", async () => {
    const sub = `sub_${randomUUID()}`;
    await handle(
      fake.event("subscription.renewed", {
        userId,
        subscriptionId: sub,
        planId: "pro",
        ...period("2026-09-25T00:00:00.000Z"),
      }),
    );
    await handle(
      fake.event("subscription.renewed", {
        userId,
        subscriptionId: sub,
        planId: "pro",
        ...period("2026-10-25T00:00:00.000Z"),
        occurredAt: new Date(Date.now() + 1000),
      }),
    );
    expect(sent).toHaveLength(2);
  });

  test("订阅取消：带到期日；同一订阅只通知一次", async () => {
    const sub = `sub_${randomUUID()}`;
    const renewed = period("2026-09-25T00:00:00.000Z");
    await handle(
      fake.event("subscription.renewed", {
        userId,
        subscriptionId: sub,
        planId: "pro",
        ...renewed,
        occurredAt: new Date("2026-09-25T00:00:00.000Z"),
      }),
    );
    sent.length = 0;
    const cancel = (occurredAt: string) =>
      fake.event("subscription.canceled", {
        userId,
        subscriptionId: sub,
        currentPeriodEnd: renewed.currentPeriodEnd,
        occurredAt: new Date(occurredAt),
      });
    await handle(cancel("2026-09-26T00:00:00.000Z"));
    // 例如 Creem 先推 scheduled_cancel、到期时再推 canceled，都映射为 subscription.canceled。
    await handle(cancel("2026-10-25T00:00:00.000Z"));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      template: "subscription-canceled",
      props: {
        planName: "[de] Pro",
        endsAt: renewed.currentPeriodEnd.toISOString(),
      },
    });
  });

  test("乱序的旧取消事件不发信", async () => {
    const sub = `sub_${randomUUID()}`;
    await handle(
      fake.event("subscription.renewed", {
        userId,
        subscriptionId: sub,
        planId: "pro",
        ...period("2026-10-25T00:00:00.000Z"),
        occurredAt: new Date("2026-10-25T00:00:00.000Z"),
      }),
    );
    sent.length = 0;
    const result = await handle(
      fake.event("subscription.canceled", {
        userId,
        subscriptionId: sub,
        occurredAt: new Date("2026-09-30T00:00:00.000Z"),
      }),
    );
    expect(result).toMatchObject({ status: "processed", stale: true });
    expect(sent).toHaveLength(0);
  });

  test("事务回滚时不发信，去重名额也一起回滚", async () => {
    registerOnBillingEvent("test:boom", () => {
      throw new Error("later hook failed");
    });
    const event = fake.event("checkout.completed", {
      userId,
      checkoutId: "chk",
      orderId: `ord_${randomUUID()}`,
      planId: "lifetime",
    });
    await expect(handle(event)).rejects.toThrow();
    expect(sent).toHaveLength(0);
    const claims = await db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.userId, userId));
    expect(claims).toHaveLength(0);

    // 服务商重试同一事件：这次成功，邮件正常发出。
    useHandler();
    expect((await handle(event)).status).toBe("processed");
    expect(sent).toHaveLength(1);
  });

  test("发信失败：webhook 仍返回 200，订单照常更新", async () => {
    failSend = true;
    const orderId = `ord_${randomUUID()}`;
    const response = await processWebhook(
      fake,
      fake.request(
        fake.event("checkout.completed", {
          userId,
          checkoutId: "chk",
          orderId,
          planId: "lifetime",
          amount: 19900,
          currency: "USD",
        }),
      ),
      { db },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "processed" });
  });

  test("EMAIL_TRANSPORT=file：真实渲染并写入发件箱", async () => {
    const previous = process.env.EMAIL_TRANSPORT;
    process.env.EMAIL_TRANSPORT = "file";
    try {
      useHandler(sendEmail);
      const since = new Date();
      await handle(
        fake.event("payment.failed", {
          userId,
          subscriptionId: `sub_${randomUUID()}`,
          amount: 1900,
          currency: "USD",
        }),
      );
      const stored = await readLatestEmail({
        to: email,
        template: "payment-failed",
        since,
      });
      expect(stored?.locale).toBe("de");
      expect(stored?.subject).toContain("[de]");
      expect(stored?.html).toContain(`https://${siteConfig.domain}/de/billing`);
    } finally {
      process.env.EMAIL_TRANSPORT = previous;
    }
  });

  test("用户删除后去重记录随之删除", async () => {
    await handle(
      fake.event("payment.failed", {
        userId,
        subscriptionId: `sub_${randomUUID()}`,
      }),
    );
    await db.delete(user).where(eq(user.id, userId));
    const left = await db
      .select()
      .from(notificationLog)
      .where(and(eq(notificationLog.userId, userId)));
    expect(left).toHaveLength(0);
  });
});
