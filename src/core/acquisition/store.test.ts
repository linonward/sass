// @vitest-environment node
import { randomUUID } from "node:crypto";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createDbClient, type DbClient } from "@/core/db/client";
import { user } from "@/core/db/schema";
import { captureEntry } from "./context";
import { createAttributionStore } from "./store";
const url = process.env.DATABASE_URL_TEST;
if (!url && process.env.CI)
  throw new Error("DATABASE_URL_TEST must be set in CI");
describe.skipIf(!url)("attribution database", () => {
  let client: DbClient;
  let store: ReturnType<typeof createAttributionStore>;
  const ids: string[] = [];
  beforeAll(async () => {
    const pool = new Pool({ connectionString: url });
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: path.resolve(__dirname, "../../../drizzle"),
    });
    await pool.end();
    client = createDbClient(url!);
    store = createAttributionStore(client.db);
  });
  afterAll(async () => {
    for (const id of ids) await client.db.delete(user).where(eq(user.id, id));
    await client?.close();
  });
  async function newUser() {
    const id = randomUUID();
    ids.push(id);
    await client.db
      .insert(user)
      .values({ id, name: "Attribution test", email: `${id}@example.com` });
    return id;
  }
  const first = captureEntry(
    { pathname: "/", utm_source: "first" },
    "site.test",
  )!;
  const second = captureEntry(
    { pathname: "/", utm_source: "second" },
    "site.test",
  )!;
  test("old users remain unknown; concurrent retries freeze exactly once; later writes cannot replace source", async () => {
    const id = await newUser();
    expect(await store.get(id)).toBeNull();
    await Promise.all(
      Array.from({ length: 6 }, () => store.freeze(id, first, Date.now())),
    );
    await store.freeze(id, second, Date.now());
    expect((await store.get(id))?.snapshot).toEqual(first);
  });
  test("withdrawal prevents delayed retry resurrection and user deletion cascades", async () => {
    const id = await newUser();
    await store.withdraw(id);
    await store.freeze(id, first, Date.now());
    expect((await store.get(id))?.snapshot).toBeNull();
    await client.db.delete(user).where(eq(user.id, id));
    expect(await store.get(id)).toBeNull();
  });
  test("concurrent withdrawal and registration leave no source", async () => {
    const id = await newUser();
    await Promise.all([
      store.freeze(id, first, Date.now()),
      store.withdraw(id),
    ]);
    expect((await store.get(id))?.snapshot).toBeNull();
  });
});
