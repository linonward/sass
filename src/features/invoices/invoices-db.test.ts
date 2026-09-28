// @vitest-environment node
import { randomUUID } from "node:crypto";
import path from "node:path";

import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { createDbClient, type DbClient } from "@/core/db/client";
import { user } from "@/core/db/schema";

import { createInvoice, deleteInvoice, updateInvoice } from "./actions";
import { listInvoices } from "./queries";
import { invoices } from "./schema";

// 真库测试：查询和三个写操作的归属校验都只有连着 Postgres 才测得准。
// 没有 DATABASE_URL_TEST 时跳过（本地没配库、纯前端改动场景），CI 里必须配
// （缺了会在下面直接抛错，不会静默跳过）。
//
// 这里能直接调 Server Action：refresh() 和登录态都被换成假实现，SQL 是真的。
// 越权（改别人的发票）不是靠这段代码自觉，而是 where 里永远带着 user_id —— 测的就是它。

const url = process.env.DATABASE_URL_TEST;
if (!url && process.env.CI) throw new Error("DATABASE_URL_TEST required");

let client: DbClient;
let session: { user: { id: string; email: string } } | null = null;

vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("@/core/auth/session", () => ({
  getSession: async () => session,
}));
vi.mock("@/core/db", () => ({ getDb: () => client.db }));

describe.skipIf(!url)("invoices (DB)", () => {
  const createdUsers: string[] = [];

  beforeAll(async () => {
    const pool = new Pool({ connectionString: url });
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: path.resolve(__dirname, "../../../drizzle"),
    });
    await pool.end();
    client = createDbClient(url!);
  });

  afterAll(async () => {
    // 发票挂在 user 上并级联删除，删掉用例创建的账号就清干净了。
    if (createdUsers.length)
      await client.db.delete(user).where(inArray(user.id, createdUsers));
    await client.close();
  });

  /** 建一个测试账号，返回它的 id。 */
  async function account() {
    const value = {
      id: randomUUID(),
      name: "Invoice test",
      email: `${randomUUID()}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
    };
    createdUsers.push(value.id);
    await client.db.insert(user).values(value);
    return value;
  }

  /** 直接插一行发票（绕开 action，测查询用）。 */
  async function seed(
    userId: string,
    row: { customerName: string; amount?: number; createdAt?: Date },
  ) {
    const [inserted] = await client.db
      .insert(invoices)
      .values({
        userId,
        customerName: row.customerName,
        amount: row.amount ?? 125000,
        ...(row.createdAt ? { createdAt: row.createdAt } : {}),
      })
      .returning();
    return inserted!;
  }

  function invoiceForm(fields: {
    id?: string;
    customerName?: string;
    amount?: string;
    status?: string;
  }) {
    const form = new FormData();
    form.set("customerName", fields.customerName ?? "Acme Inc.");
    form.set("amount", fields.amount ?? "1250.00");
    form.set("status", fields.status ?? "draft");
    if (fields.id) form.set("id", fields.id);
    return form;
  }

  test("列表只返回自己的发票，搜索不区分大小写且通配符按字面匹配", async () => {
    const owner = await account();
    const other = await account();
    await seed(owner.id, { customerName: "Acme Inc." });
    await seed(owner.id, { customerName: "Globex %100" });
    await seed(other.id, { customerName: "Acme Inc." });

    const mine = await listInvoices(client.db, { userId: owner.id });
    expect(mine.total).toBe(2);
    expect(mine.rows.map((row) => row.userId)).toEqual([owner.id, owner.id]);

    const searched = await listInvoices(client.db, {
      userId: owner.id,
      query: "acme",
    });
    expect(searched.rows.map((row) => row.customerName)).toEqual(["Acme Inc."]);

    // `%` 和 `_` 是 LIKE 的通配符：搜 `%100` 不该把两行都捞出来。
    const literal = await listInvoices(client.db, {
      userId: owner.id,
      query: "%100",
    });
    expect(literal.rows.map((row) => row.customerName)).toEqual([
      "Globex %100",
    ]);
  });

  test("分页：每页 10 条、最新的在前，第二页只剩零头", async () => {
    const owner = await account();
    const base = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 12; i++) {
      await seed(owner.id, {
        customerName: `Customer ${String(i).padStart(2, "0")}`,
        createdAt: new Date(base + i * 60_000),
      });
    }

    const first = await listInvoices(client.db, { userId: owner.id, page: 1 });
    expect(first.total).toBe(12);
    expect(first.totalPages).toBe(2);
    expect(first.rows).toHaveLength(10);
    expect(first.rows[0]!.customerName).toBe("Customer 11");

    const second = await listInvoices(client.db, { userId: owner.id, page: 2 });
    expect(second.rows).toHaveLength(2);
    expect(second.rows.map((row) => row.customerName)).toEqual([
      "Customer 01",
      "Customer 00",
    ]);
  });

  test("创建归属当前登录用户；没登录或金额非法时不写库", async () => {
    const owner = await account();
    session = { user: { id: owner.id, email: owner.email } };

    expect(await createInvoice({ status: "idle" }, invoiceForm({}))).toEqual({
      status: "success",
    });
    const [row] = await client.db
      .select()
      .from(invoices)
      .where(eq(invoices.userId, owner.id));
    expect(row!.userId).toBe(owner.id);
    expect(row!.amount).toBe(125000);
    expect(row!.status).toBe("draft");

    expect(
      await createInvoice({ status: "idle" }, invoiceForm({ amount: "0" })),
    ).toEqual({ status: "error", error: "invalid" });
    session = null;
    expect(await createInvoice({ status: "idle" }, invoiceForm({}))).toEqual({
      status: "error",
      error: "unauthorized",
    });
    // 两次被拒都没有新增行。
    const rows = await client.db
      .select()
      .from(invoices)
      .where(eq(invoices.userId, owner.id));
    expect(rows).toHaveLength(1);
  });

  test("改不到别人的发票：越权按「查不到」处理，数据原样", async () => {
    const owner = await account();
    const attacker = await account();
    const target = await seed(owner.id, { customerName: "Acme Inc." });

    session = { user: { id: attacker.id, email: attacker.email } };
    expect(
      await updateInvoice(
        { status: "idle" },
        invoiceForm({ id: target.id, customerName: "Hijacked" }),
      ),
    ).toEqual({ status: "error", error: "not_found" });
    expect(
      await deleteInvoice({ status: "idle" }, invoiceForm({ id: target.id })),
    ).toEqual({ status: "error", error: "not_found" });

    const [after] = await client.db
      .select()
      .from(invoices)
      .where(eq(invoices.id, target.id));
    expect(after!.customerName).toBe("Acme Inc.");

    // 自己的才改得动。
    session = { user: { id: owner.id, email: owner.email } };
    expect(
      await updateInvoice(
        { status: "idle" },
        invoiceForm({
          id: target.id,
          customerName: "Acme Inc.",
          amount: "10.50",
          status: "paid",
        }),
      ),
    ).toEqual({ status: "success" });
    const [updated] = await client.db
      .select()
      .from(invoices)
      .where(eq(invoices.id, target.id));
    expect(updated!.amount).toBe(1050);
    expect(updated!.status).toBe("paid");
  });

  test("删除只删自己的那一行", async () => {
    const owner = await account();
    const mine = await seed(owner.id, { customerName: "Mine" });
    const other = await seed(owner.id, { customerName: "Also mine" });
    session = { user: { id: owner.id, email: owner.email } };

    expect(
      await deleteInvoice({ status: "idle" }, invoiceForm({ id: mine.id })),
    ).toEqual({ status: "success" });
    const remaining = await client.db
      .select()
      .from(invoices)
      .where(eq(invoices.userId, owner.id));
    expect(remaining.map((row) => row.id)).toEqual([other.id]);

    // 删不存在的 id 同样是 not_found，不会静默成功。
    expect(
      await deleteInvoice({ status: "idle" }, invoiceForm({ id: mine.id })),
    ).toEqual({ status: "error", error: "not_found" });
    // id 不是 uuid 时连库都不碰。
    expect(
      await deleteInvoice({ status: "idle" }, invoiceForm({ id: "nope" })),
    ).toEqual({ status: "error", error: "invalid" });
  });
});
