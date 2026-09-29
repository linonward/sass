#!/usr/bin/env node
// Checks that the migration metadata in drizzle/ is self-consistent. CI runs it on every PR and fails
// on any inconsistency.
//
// Why this exists: drizzle's migrator (migrate in drizzle-orm/pg-core/dialect.cjs) decides "should
// this migration run" with exactly one test —
//
//     if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis)
//
// where `lastDbMigration` is the first row of `drizzle.__drizzle_migrations` ordered by created_at
// descending, read **once before the loop starts** and never again; `created_at` is what was written
// from the journal's `when`. So:
//
//   * When `when` is not strictly increasing, a migration whose `when` is smaller than the current
//     max created_at is **skipped forever** (no error, no retry, it just silently never runs) —
//     production is missing tables until someone notices. It happened in 2026-09: the `when` of
//     0017_clever_toxin was smaller than 0016's, production skipped 0017, and the very first ALTER
//     in 0018_referral_rewards referenced a table 0017 creates, breaking the build.
//   * Every migration must have a `meta/NNNN_snapshot.json` whose prevId links to the previous id.
//     With one missing, `db:generate` diffs against an older snapshot and emits SQL that recreates
//     existing tables.
//
// The four things this script checks (all offline, only repo files, no database connection):
//
//   1. `idx` is contiguous from 0;
//   2. `when` is strictly increasing;
//   3. tags are unique and each tag's numeric prefix equals idx (catches duplicates like "two 0018s");
//   4. every migration has a SQL file and a snapshot file, and the snapshot's prevId links to the
//      previous snapshot's id.
//
// Usage: node scripts/check-migrations.mjs      same as pnpm migrations:check
//
// How to fix failures: edit drizzle/meta/_journal.json (order, when, tag) and drizzle/meta/*.json
// (the snapshot chain). Don't change the content of migrations that are already live — changing
// `when` only affects whether databases that haven't run it yet will run it; databases that already
// ran it skip it via the created_at comparison. When unsure, verify with `pnpm db:migrate` on a Neon
// branch or an empty local database first.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(root, file), "utf8");

const fails = [];
const fail = (message) => fails.push(message);

const journalPath = "drizzle/meta/_journal.json";
const journal = JSON.parse(read(journalPath));
const pad = (idx) => String(idx).padStart(4, "0");
const snapshotPath = (idx) => `drizzle/meta/${pad(idx)}_snapshot.json`;
const readSnapshot = (idx) => JSON.parse(read(snapshotPath(idx)));

// The idx 0 snapshot has no predecessor; drizzle-kit writes an all-zero UUID.
const NO_PREV = "00000000-0000-0000-0000-000000000000";

let previous = null;
for (const [position, entry] of journal.entries.entries()) {
  const { idx, when, tag } = entry;

  if (idx !== position) {
    fail(
      `${journalPath} entry ${position} has idx ${idx} — idx must be contiguous from 0, otherwise drizzle-kit generates migrations with duplicate numbers.`,
    );
  }

  if (previous && when <= previous.when) {
    fail(
      `when must be strictly increasing: ${previous.tag}(${previous.when}) → ${tag}(${when}). ` +
        `The migrator only compares created_at < when, so on a database with an existing ledger the migration with the smaller when is skipped forever.`,
    );
  }

  if (tag !== `${pad(idx)}_${tag.replace(/^\d+_/, "")}`) {
    fail(
      `${journalPath}: idx ${idx} has tag ${tag} — the numeric prefix must match idx (expected ${pad(idx)}_…).`,
    );
  }

  if (journal.entries.filter((other) => other.tag === tag).length > 1) {
    fail(`${journalPath}: tag ${tag} appears more than once.`);
  }

  if (!existsSync(join(root, "drizzle", `${tag}.sql`))) {
    fail(
      `drizzle/${tag}.sql does not exist — each tag in the journal needs a SQL file of the same name.`,
    );
  }

  if (!existsSync(join(root, snapshotPath(idx)))) {
    fail(
      `Missing snapshot ${snapshotPath(idx)} (${tag}) — without it db:generate diffs against an older snapshot and emits SQL that recreates existing tables.`,
    );
  } else {
    const expectedPrev = previous ? readSnapshot(previous.idx).id : NO_PREV;
    const { prevId } = readSnapshot(idx);
    if ((prevId ?? NO_PREV) !== expectedPrev) {
      fail(
        `${snapshotPath(idx)} has prevId ${prevId ?? "(empty)"}; it should link to the id of the previous snapshot ${snapshotPath(previous.idx)}, ${expectedPrev}.`,
      );
    }
  }

  previous = entry;
}

// ---------------------------------------------------------------------------

if (fails.length > 0) {
  console.error(
    `Migration metadata in drizzle/ has ${fails.length} problem(s):\n`,
  );
  for (const message of fails) console.error(`- ${message}`);
  console.error(
    "\nSee the top of this file for fixes; afterwards rerun `pnpm migrations:check` " +
      "and verify with `pnpm db:migrate` on an empty database.",
  );
  process.exit(1);
}

console.log(
  `Migration metadata is consistent: ${journal.entries.length} migrations, when strictly increasing, no duplicate tags, ` +
    "snapshot chain intact.",
);
