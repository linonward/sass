#!/usr/bin/env node
/**
 * Revokes the admin role from an email address.
 *
 * `ADMIN_EMAILS` only promotes, never demotes: emails listed there are written into the user table's
 * role field at sign-in, and removing the email from the env var afterwards does **not** take the role
 * back (see src/core/admin/roles.ts). This script is the manual patch for that rule — use it when
 * admins change, or when an email should no longer be an admin.
 *
 * Usage: pnpm admin:demote <email>
 *        DATABASE_URL=postgres://… pnpm admin:demote someone@example.com
 *
 * Only strips admin from the role field and keeps other roles; the user, sessions and all data are
 * left alone. The database URL comes from the environment first, then `.env.local` (same as the site
 * runtime).
 */
import { existsSync } from "node:fs";
import process from "node:process";

import pg from "pg";

const usage = `Usage: pnpm admin:demote <email>

Revokes the admin role from an email address (only admin is removed; other roles are kept).
The database URL comes from DATABASE_URL, or .env.local when it is not set.`;

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
    "Missing DATABASE_URL: set up .env.local first, or run `DATABASE_URL=… pnpm admin:demote <email>`.",
  );
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query(
    'select id, role from "user" where lower(email) = $1',
    [email],
  );
  if (rows.length === 0) fail(`No user with this email: ${email}`);

  const [user] = rows;
  const before = user.role ?? "";
  const after = before
    .split(",")
    .map((role) => role.trim())
    .filter((role) => role && role !== "admin")
    .join(",");

  if (after === before) {
    console.log(`${email} is not an admin; nothing changed.`);
  } else {
    await client.query('update "user" set role = $2 where id = $1', [
      user.id,
      after || null,
    ]);
    console.log(
      `Revoked the admin role from ${email} (role: "${before}" → ${after ? `"${after}"` : "null"}).`,
    );
  }

  // If it's still in ADMIN_EMAILS, the next sign-in promotes it again — the step most easily missed.
  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (adminEmails.includes(email)) {
    console.warn(
      `Warning: ${email} is still in ADMIN_EMAILS and will be promoted to admin again on next sign-in. To revoke for good, remove it from the environment variable first.`,
    );
  }
} finally {
  await client.end();
}
