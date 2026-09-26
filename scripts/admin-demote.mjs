#!/usr/bin/env node
/**
 * 撤销某个邮箱的 admin 角色。
 *
 * `ADMIN_EMAILS` 只升不降：里面的邮箱在登录时会被写进用户表的 role 字段，
 * 之后从环境变量里删掉那个邮箱**不会**收回角色（见 src/core/admin/roles.ts）。
 * 这个脚本就是那条规则的手动补丁 —— 换管理员、或者某个邮箱不该再是管理员时用它。
 *
 * 用法：pnpm admin:demote <email>
 *      DATABASE_URL=postgres://… pnpm admin:demote someone@example.com
 *
 * 只从 role 字段里摘掉 admin，其他角色保留；用户本身、会话和任何数据都不动。
 * 数据库地址优先用环境变量，其次读 `.env.local`（和站点运行时一致）。
 */
import { existsSync } from "node:fs";
import process from "node:process";

import pg from "pg";

const usage = `用法：pnpm admin:demote <email>

撤销某个邮箱的 admin 角色（只摘掉 admin，其他角色保留）。
数据库地址取 DATABASE_URL，没设时读 .env.local。`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const email = process.argv[2]?.trim().toLowerCase();
if (!email) fail(usage);

const url = process.env.DATABASE_URL;
if (!url) {
  fail(
    "缺少 DATABASE_URL：先配好 .env.local，或用 `DATABASE_URL=… pnpm admin:demote <email>`。",
  );
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query(
    'select id, role from "user" where lower(email) = $1',
    [email],
  );
  if (rows.length === 0) fail(`没有这个邮箱的用户：${email}`);

  const [user] = rows;
  const before = user.role ?? "";
  const after = before
    .split(",")
    .map((role) => role.trim())
    .filter((role) => role && role !== "admin")
    .join(",");

  if (after === before) {
    console.log(`${email} 本来就不是 admin，没有改动。`);
  } else {
    await client.query('update "user" set role = $2 where id = $1', [
      user.id,
      after || null,
    ]);
    console.log(
      `已撤销 ${email} 的 admin 角色（role: "${before}" → ${after ? `"${after}"` : "null"}）。`,
    );
  }

  // 还留在 ADMIN_EMAILS 里的话，下次登录会被重新提上来 —— 这是最容易被忽略的一步。
  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (adminEmails.includes(email)) {
    console.warn(
      `注意：${email} 还在 ADMIN_EMAILS 里，下次登录会被重新提升为 admin。要彻底撤销，请先从环境变量里删掉它。`,
    );
  }
} finally {
  await client.end();
}
