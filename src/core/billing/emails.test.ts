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
import { notificationLog, pendingNotifications, user } from "@/core/db/schema";
import { createOutbox, type DeliveryRetry } from "@/core/email/outbox";
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

// Simulate a multilingual site; the second language's copy is pseudo-translated from en.json.
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
if (!url)
  console.warn("Skipping billing email tests: DATABASE_URL_TEST is not set");

type Sent = SendEmailOptions<
  "payment-succeeded" | "payment-failed" | "subscription-canceled"
>;

describe("billingEmailFor trigger mapping", () => {
  const fake = new FakeProvider();
  test.each([
    [
      "one-time purchase",
      fake.event("checkout.completed", {
        checkoutId: "c",
        orderId: "ord_1",
        planId: "lifetime",
      }),
      "payment-succeeded",
    ],
    [
      "subscription checkout (handled by the renewal event)",
      fake.event("checkout.completed", {
        checkoutId: "c",
        orderId: "ord_1",
        subscriptionId: "sub_1",
      }),
      null,
    ],
    [
      "subscription renewal",
      fake.event("subscription.renewed", { subscriptionId: "sub_1" }),
      "payment-succeeded",
    ],
    [
      "payment failed",
      fake.event("payment.failed", { subscriptionId: "sub_1" }),
      "payment-failed",
    ],
    [
      "subscription canceled",
      fake.event("subscription.canceled", { subscriptionId: "sub_1" }),
      "subscription-canceled",
    ],
    [
      "subscription activated",
      fake.event("subscription.active", { subscriptionId: "sub_1" }),
      null,
    ],
    [
      "subscription expired",
      fake.event("subscription.expired", { subscriptionId: "sub_1" }),
      null,
    ],
    [
      "refund",
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

  test("old events: payment-succeeded is still sent, payment-failed and cancellation are not", () => {
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

describe.skipIf(!url)("billing emails (real Postgres)", () => {
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

  function useHandler(
    send: typeof capture | typeof sendEmail = capture,
    retry: DeliveryRetry = { attempts: 1, delayMs: 0 },
  ) {
    resetOnBillingEvent();
    registerOnBillingEvent(
      "billing:emails",
      createBillingEmailHandler({
        send: send as never,
        creditsEnabled: true,
        db,
        retry,
      }),
    );
  }

  /** This user's dedup slots (each case uses a new user, so they don't mix). */
  const claims = () =>
    db.select().from(notificationLog).where(eq(notificationLog.userId, userId));
  const outboxRows = () =>
    db
      .select()
      .from(pendingNotifications)
      .where(eq(pendingNotifications.userId, userId));

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

  test("one-time purchase: sends one payment-succeeded in the user's locale, with amount and credits", async () => {
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

  test("first subscription period: checkout completed and first payment send only one email", async () => {
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
    expect(sent[0]!.props).toMatchObject({
      kind: "subscription",
      planName: "[de] Pro",
      // When the event carries no amount, the plan's list price is used.
      amount: 1900,
      currency: "USD",
      renewsAt: "2026-10-25T00:00:00.000Z",
    });
  });

  test("the same payment pushed again with a new event ID doesn't send twice", async () => {
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

  test("repeated delivery of the same event: the second is a duplicate and sends nothing", async () => {
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

  test("a renewal for the next billing period sends another email", async () => {
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

  test("subscription canceled: includes the end date; only one notice per subscription", async () => {
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
    // e.g. Creem pushes scheduled_cancel first and canceled at expiry; both map to
    // subscription.canceled.
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

  test("an old out-of-order cancel event sends nothing", async () => {
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

  test("no email on transaction rollback, and the dedup slot rolls back too", async () => {
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

    // The provider retries the same event: this time it succeeds and the email goes out normally.
    useHandler();
    expect((await handle(event)).status).toBe("processed");
    expect(sent).toHaveLength(1);
  });

  test("send failure: webhook still returns 200 and the order still updates", async () => {
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

  test("failed sends are retried: sent after a transient failure, slot kept", async () => {
    let calls = 0;
    useHandler(
      async (message: Sent) => {
        if (++calls === 1) throw new Error("SMTP down");
        sent.push(message);
      },
      { attempts: 3, delayMs: 1 },
    );

    const sub = `sub_${randomUUID()}`;
    const fields = {
      userId,
      subscriptionId: sub,
      planId: "pro",
      ...period("2026-09-25T00:00:00.000Z"),
    };
    await handle(fake.event("subscription.renewed", fields));

    expect(calls).toBe(2);
    expect(sent.map((m) => m.template)).toEqual(["payment-succeeded"]);
    // The successful send keeps its slot: pushing the same payment again doesn't send twice.
    expect(await claims()).toHaveLength(1);
    await handle(fake.event("subscription.renewed", fields));
    expect(sent).toHaveLength(1);
  });

  test("immediate send fails: email stays in the outbox and the slot is kept; a replay doesn't queue another, and after recovery the resend sweep sends exactly one", async () => {
    useHandler(capture, { attempts: 2, delayMs: 1 });

    const sub = `sub_${randomUUID()}`;
    const fields = {
      userId,
      subscriptionId: sub,
      planId: "pro",
      ...period("2026-09-25T00:00:00.000Z"),
    };

    // Can't send (provider down, SMTP rejected): the event is still handled and the email stays in
    // the database.
    failSend = true;
    expect(
      (await handle(fake.event("subscription.renewed", fields))).status,
    ).toBe("processed");
    expect(sent).toHaveLength(0);
    expect(await claims()).toHaveLength(1);
    expect(await outboxRows()).toEqual([
      expect.objectContaining({
        status: "pending",
        template: "payment-succeeded",
        attempts: 2,
        lastError: "SMTP down",
      }),
    ]);

    // Same payment re-pushed with a new event ID: the slot is still held, so no second email is queued.
    await handle(fake.event("subscription.renewed", fields));
    expect(await outboxRows()).toHaveLength(1);

    // Service recovers: the resend sweep (a new instance, as after an app restart) sends it; two
    // sweeps still send only one.
    failSend = false;
    const later = createOutbox({
      db,
      send: capture as never,
      now: () => new Date(Date.now() + 10 * 60_000),
    });
    await later.scan({ userIds: [userId] });
    await later.scan({ userIds: [userId] });
    expect(sent.map((m) => m.template)).toEqual(["payment-succeeded"]);
    expect((await outboxRows())[0]).toMatchObject({ status: "sent" });
    expect(await claims()).toHaveLength(1);
  });

  test("EMAIL_TRANSPORT=file: really renders and writes to the outbox folder", async () => {
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

  test("dedup records are deleted along with the user", async () => {
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
