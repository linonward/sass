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

// CI must provide a test database; silently skipping is not allowed.
if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) {
  console.warn(
    "Skipping admin demote script tests: DATABASE_URL_TEST is not set",
  );
}

describe.skipIf(!url)("scripts/admin-demote.mjs", () => {
  let client: DbClient;
  let db: DbClient["db"];

  const script = path.resolve(__dirname, "../../../scripts/admin-demote.mjs");

  /** Runs the script and returns stdout/stderr and the exit code (a non-zero exit does not throw). */
  async function demote(email: string, env: Record<string, string> = {}) {
    try {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [script, email],
        {
          env: {
            ...process.env,
            DATABASE_URL: url,
            // The script reads .env.local; pin ADMIN_EMAILS here so the dev environment can't affect it.
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

  test("removes admin and keeps the other roles", async () => {
    const { id, email } = await newUser("admin,editor");

    const result = await demote(email);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Revoked the admin role");
    expect(await roleOf(id)).toBe("editor");
  });

  test("sets role to null when admin was the only role", async () => {
    const { id, email } = await newUser("admin");

    expect((await demote(email)).code).toBe(0);

    expect(await roleOf(id)).toBeNull();
  });

  test("leaves a non-admin user unchanged", async () => {
    const { id, email } = await newUser("editor");

    const result = await demote(email);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("is not an admin");
    expect(await roleOf(id)).toBe("editor");
  });

  test("warns that the user will be promoted again while the email is still in ADMIN_EMAILS", async () => {
    const { email } = await newUser("admin");

    const result = await demote(email, { ADMIN_EMAILS: email });

    expect(result.stderr).toContain("ADMIN_EMAILS");
  });

  test("matches the email case-insensitively", async () => {
    const { id, email } = await newUser("admin");

    expect((await demote(email.toUpperCase())).code).toBe(0);

    expect(await roleOf(id)).toBeNull();
  });

  test("exits non-zero when there is no such user", async () => {
    const result = await demote(`nobody-${randomUUID()}@example.com`);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("No user with this email");
  });

  test("prints usage and exits when no email is given", async () => {
    const result = await demote("");

    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toContain("pnpm admin:demote");
  });
});
