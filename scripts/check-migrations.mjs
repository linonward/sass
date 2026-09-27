#!/usr/bin/env node
// 检查 drizzle/ 的迁移元数据自洽。CI 每个 PR 都跑，不自洽直接失败。
//
// 为什么需要它：drizzle 的迁移器（drizzle-orm/pg-core/dialect.cjs 的 migrate）
// 判断「这条迁移要不要执行」只做一件事 ——
//
//     if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis)
//
// 其中 `lastDbMigration` 是**循环开始前**从 `drizzle.__drizzle_migrations` 里
// 按 created_at 倒序取的第一行，整个循环里只读这一次；`created_at` 写进去的就是
// journal 里的 `when`。于是：
//
//   * `when` 不是严格递增时，`when` 比当前最大 created_at 小的那条会被**永久
//     跳过**（不是报错、不是重试，是静默不执行）——线上缺表，直到有人发现。
//     2026-09 就出过一次：0017_clever_toxin 的 when 比 0016 小，生产跳过了 0017，
//     紧接着 0018_referral_rewards 的第一条 ALTER 引用了 0017 建的表，构建挂掉。
//   * 每条迁移都必须有一张 `meta/NNNN_snapshot.json`，且 prevId 接上一张的 id。
//     少一张，`db:generate` 就会拿更早的快照去 diff，吐出重建既有表的 SQL。
//
// 本脚本查的四件事（全部离线、只看仓库文件，不连数据库）：
//
//   1. `idx` 从 0 起连续；
//   2. `when` 严格递增；
//   3. tag 不重复，且 tag 的数字前缀等于 idx（挡住「两个 0018」这种重号）；
//   4. 每条迁移都有 SQL 文件与快照文件，快照的 prevId 接得上上一张的 id。
//
// 用法：node scripts/check-migrations.mjs      等同 pnpm migrations:check
//
// 报错怎么修：改 drizzle/meta/_journal.json（顺序、when、tag）与 drizzle/meta/*.json
// （快照链）。已经上线的迁移不要改内容 —— 改 when 只影响「还没执行过的库要不要执行」，
// 已经执行过的库靠 created_at 比对会跳过它；拿不准时先在一个 Neon 分支或本地空库上
// 跑一遍 `pnpm db:migrate` 验证。

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

// idx 0 的快照没有上一张，drizzle-kit 写的是全零 UUID。
const NO_PREV = "00000000-0000-0000-0000-000000000000";

let previous = null;
for (const [position, entry] of journal.entries.entries()) {
  const { idx, when, tag } = entry;

  if (idx !== position) {
    fail(
      `${journalPath} 第 ${position} 项的 idx 是 ${idx} —— idx 必须从 0 起连续，否则 drizzle-kit 生成的迁移会重号。`,
    );
  }

  if (previous && when <= previous.when) {
    fail(
      `when 必须严格递增：${previous.tag}(${previous.when}) → ${tag}(${when})。` +
        `迁移器只比较 created_at < when，when 偏小的那条在已有账本的库上会被永久跳过。`,
    );
  }

  if (tag !== `${pad(idx)}_${tag.replace(/^\d+_/, "")}`) {
    fail(
      `${journalPath} 里 idx ${idx} 的 tag 是 ${tag} —— 数字前缀要和 idx 一致（应为 ${pad(idx)}_…）。`,
    );
  }

  if (journal.entries.filter((other) => other.tag === tag).length > 1) {
    fail(`${journalPath} 里 tag ${tag} 出现了不止一次。`);
  }

  if (!existsSync(join(root, "drizzle", `${tag}.sql`))) {
    fail(
      `drizzle/${tag}.sql 不存在 —— journal 里的 tag 要对应同名的 SQL 文件。`,
    );
  }

  if (!existsSync(join(root, snapshotPath(idx)))) {
    fail(
      `缺快照 ${snapshotPath(idx)}（${tag}）—— 少了它 db:generate 会拿更早的快照 diff，吐出重建既有表的 SQL。`,
    );
  } else {
    const expectedPrev = previous ? readSnapshot(previous.idx).id : NO_PREV;
    const { prevId } = readSnapshot(idx);
    if ((prevId ?? NO_PREV) !== expectedPrev) {
      fail(
        `${snapshotPath(idx)} 的 prevId 是 ${prevId ?? "（空）"}，应接上一张快照 ${snapshotPath(previous.idx)} 的 id ${expectedPrev}。`,
      );
    }
  }

  previous = entry;
}

// ---------------------------------------------------------------------------

if (fails.length > 0) {
  console.error(`drizzle/ 的迁移元数据有 ${fails.length} 处问题：\n`);
  for (const message of fails) console.error(`- ${message}`);
  console.error(
    "\n修法见本文件开头；改完再跑一次 `pnpm migrations:check`，" +
      "并在空库上跑 `pnpm db:migrate` 验证一遍。",
  );
  process.exit(1);
}

console.log(
  `迁移元数据自洽：${journal.entries.length} 条迁移，when 严格递增、tag 不重号、` +
    "快照链闭合。",
);
