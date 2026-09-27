import { existsSync } from "node:fs";
import pg from "pg";
import { cleanupLeadsSql } from "../src/core/acquisition/leads/cleanup.ts";
for (const file of [".env.local", ".env"])
  if (existsSync(file)) process.loadEnvFile(file);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const { rows } = await client.query(cleanupLeadsSql, [new Date()]);
  console.log(`Anonymized ${rows[0].cleared} expired leads.`);
} finally {
  await client.end();
}
