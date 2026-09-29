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

// Real-database tests: the queries and the ownership checks of the three writes can only be tested
// properly against Postgres. Skipped without DATABASE_URL_TEST (no local database, frontend-only
// changes); CI must set it (if it's missing there, the code below throws rather than silently
// skipping).
//
// Server Actions can be called directly here: refresh() and the session are faked, the SQL is
// real. Cross-user access (editing someone else's invoice) isn't prevented by the code being
// careful, but by user_id always being in the where clause — that's what this tests.

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
    // Invoices belong to a user and cascade on delete, so deleting the test accounts cleans up.
    if (createdUsers.length)
      await client.db.delete(user).where(inArray(user.id, createdUsers));
    await client.close();
  });

  /** Create a test account and return its id. */
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

  /** Insert an invoice row directly (bypassing the action, for query tests). */
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

  test("the list returns only your own invoices; search is case-insensitive and wildcards match literally", async () => {
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

    // `%` and `_` are LIKE wildcards: searching `%100` shouldn't pull up both rows.
    const literal = await listInvoices(client.db, {
      userId: owner.id,
      query: "%100",
    });
    expect(literal.rows.map((row) => row.customerName)).toEqual([
      "Globex %100",
    ]);
  });

  test("pagination: 10 per page, newest first, the second page holds the remainder", async () => {
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

  test("create belongs to the signed-in user; nothing is written when signed out or the amount is invalid", async () => {
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
    // Neither rejected attempt added a row.
    const rows = await client.db
      .select()
      .from(invoices)
      .where(eq(invoices.userId, owner.id));
    expect(rows).toHaveLength(1);
  });

  test("can't update someone else's invoice: cross-user access is treated as not found and data is untouched", async () => {
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

    // Only your own can be updated.
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

  test("delete removes only your own row", async () => {
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

    // Deleting a nonexistent id is also not_found, not a silent success.
    expect(
      await deleteInvoice({ status: "idle" }, invoiceForm({ id: mine.id })),
    ).toEqual({ status: "error", error: "not_found" });
    // A non-uuid id doesn't even touch the database.
    expect(
      await deleteInvoice({ status: "idle" }, invoiceForm({ id: "nope" })),
    ).toEqual({ status: "error", error: "invalid" });
  });
});
