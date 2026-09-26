// @vitest-environment node
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createDbClient, type DbClient } from "@/core/db/client";
import { user } from "@/core/db/schema";

const execFileAsync = promisify(execFile);
const url = process.env.DATABASE_URL_TEST;

// CI 必须提供测试库，不允许静默跳过。
if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) {
  console.warn("跳过 admin 降级脚本测试：未设置 DATABASE_URL_TEST");
}

describe.skipIf(!url)("scripts/admin-demote.mjs", () => {
  let client: DbClient;
  let db: DbClient["db"];

  const script = path.resolve(__dirname, "../../../scripts/admin-demote.mjs");

  /** 跑脚本，返回 stdout/stderr 和退出码（非零不抛）。 */
  async function demote(email: string, env: Record<string, string> = {}) {
    try {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [script, email],
        {
          env: {
            ...process.env,
            DATABASE_URL: url,
            // 脚本会读 .env.local，这里把 ADMIN_EMAILS 固定住，避免受开发环境影响。
            ADMIN_EMAILS: env.ADMIN_EMAILS ?? "",
            ...env,
          },
        },
      );
      return { code: 0, stdout, stderr };
    } catch (error) {
      const failure = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
      };
      return {
        code: failure.code ?? 1,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? "",
      };
    }
  }

  async function newUser(role: string | null) {
    const id = `demote-test-${randomUUID()}`;
    const email = `${id}@example.com`;
    await db.insert(user).values({ id, name: "Demote Test", email, role });
    return { id, email };
  }

  const roleOf = async (id: string) => {
    const [row] = await db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, id));
    return row?.role ?? null;
  };

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

  test("admin 被摘掉，其他角色保留", async () => {
    const { id, email } = await newUser("admin,editor");

    const result = await demote(email);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("已撤销");
    expect(await roleOf(id)).toBe("editor");
  });

  test("只有 admin 一个角色时 role 置空", async () => {
    const { id, email } = await newUser("admin");

    expect((await demote(email)).code).toBe(0);

    expect(await roleOf(id)).toBeNull();
  });

  test("不是 admin 的用户不动它", async () => {
    const { id, email } = await newUser("editor");

    const result = await demote(email);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("本来就不是 admin");
    expect(await roleOf(id)).toBe("editor");
  });

  test("邮箱还在 ADMIN_EMAILS 里时提醒会被重新提升", async () => {
    const { email } = await newUser("admin");

    const result = await demote(email, { ADMIN_EMAILS: email });

    expect(result.stderr).toContain("ADMIN_EMAILS");
  });

  test("邮箱大小写不敏感", async () => {
    const { id, email } = await newUser("admin");

    expect((await demote(email.toUpperCase())).code).toBe(0);

    expect(await roleOf(id)).toBeNull();
  });

  test("没有这个用户时非零退出", async () => {
    const result = await demote(`nobody-${randomUUID()}@example.com`);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("没有这个邮箱的用户");
  });

  test("没给邮箱时打印用法并退出", async () => {
    const result = await demote("");

    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toContain("pnpm admin:demote");
  });
});
