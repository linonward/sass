#!/usr/bin/env node
// 检查 THIRD-PARTY-NOTICES.md（下称 TPN）有没有和实际依赖漂移。
//
// 为什么需要它：TPN 是随付费产品一起交给买家的法律合规文件，它声明的是「买家
// `pnpm install` 之后**实际**装到的版本与许可」。dependabot 每周开依赖 PR，TPN
// 不会自己跟着变 —— 文件末尾写着「改依赖后重跑 pnpm licenses list」，但没有任何
// 东西会提醒，于是声明的版本和实际装到的版本越差越远。这个脚本就是那个提醒：
// CI 每个 PR 都跑，漂移直接失败。
//
// 两段检查：
//
//   1. 版本表 ↔ pnpm-lock.yaml（离线、确定性、与平台无关）
//      「直接依赖明细」里每个包的版本必须等于锁文件给直接依赖解析出的版本，
//      依赖类型（prod / dev）也要对得上；两个方向都查 —— 表里少了包、多了包
//      （删依赖后没清理）都算漂移。锁文件与 package.json 不同步也在这里挡下。
//
//   2. 许可 ↔ `pnpm licenses list`（需要 node_modules，CI 已装）
//      只校验两件与平台无关的事：
//        - 报出来的许可标识必须在两张分布表里各占一行 —— 冒出没写过的许可就得
//          有人来补一行并交代它有没有义务，而不是静悄悄过去；
//        - 没有 GPL / AGPL / SSPL 这类强 copyleft（文件里明写了「没有」）。
//          只查不带 `AND` / `OR` 的单一许可标识：`(A OR B)` 这种双许可可以挑
//          宽松的那支，不是本脚本能替人做的判断，交给人工。
//
//      **故意不比对**两张分布表的包数：那个数字按当前平台装上的可选依赖计
//      （`@swc/core-*`、`@img/sharp-libvips-*`、`lightningcss-*` …），在 macOS
//      上生成的数字在 Linux CI 上必然对不上（例如 `@swc/core-darwin-arm64` 是
//      `Apache-2.0 AND MIT`，Linux 对应包不是）。包数只作为参考打印出来。
//
// 用法：node scripts/check-notices.mjs      等同 pnpm notices:check
//
// 改依赖后怎么修：跑一次 `pnpm licenses list`（全量）和 `pnpm licenses list --prod`
// 更新两张分布表，再按打印出来的漂移逐条改「直接依赖明细」的版本，最后重跑本脚本。

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(root, file), "utf8");

const NOTICES = "THIRD-PARTY-NOTICES.md";

// 强 copyleft 黑名单：TPN 的「没有 GPL、AGPL、SSPL 这类强 copyleft 许可」说的就是这些。
const STRONG_COPYLEFT =
  /^(A?GPL-|SSPL-|OSL-|CPL-|CPAL-|EUPL-|BUSL-|Commons-Clause|RPL-|QPL-)/i;

const failures = [];
const fail = (message) => failures.push(message);

// ---------------------------------------------------------------------------
// 直接依赖：package.json + pnpm-lock.yaml

// 锁文件是「多文档」YAML（`---` 分隔）：第一份是 pnpm 自己那棵树（pnpm 版本、
// @pnpm/exe.*），最后一份才是本项目的。`importers` / `packages` 这类顶层键只
// 出现在各自文档里，所以逐份扫描、按下标缩进归属即可，不必上 YAML 解析器。
const LOCK_SECTIONS = new Map([
  ["dependencies", "prod"],
  ["devDependencies", "dev"],
  ["optionalDependencies", "prod"],
]);

const unquote = (value) =>
  /^'.*'$/.test(value) || /^".*"$/.test(value) ? value.slice(1, -1) : value;

// `version: 1.2.3(react@19.3.0)` —— 括号里是 peer 组合，不是版本的一部分。
const cleanVersion = (value) =>
  unquote(value.trim()).replace(/\(.*$/, "").trim();

function lockfileDirectDeps() {
  const found = new Map();
  for (const doc of read("pnpm-lock.yaml").split(/^---\s*$/m)) {
    const lines = doc.split("\n");
    const start = lines.indexOf("importers:");
    if (start === -1) continue;

    let importer = null;
    let section = null;
    let name = null;
    for (let i = start + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.trim() === "") continue;
      const indent = line.length - line.trimStart().length;
      if (indent === 0) break; // 下一节（packages: / settings: …）
      const entry = /^([^:]+):\s*(.*)$/.exec(line.trim());
      if (!entry) continue;
      const key = unquote(entry[1]);
      const value = entry[2];

      if (indent === 2) {
        importer = key;
        section = null;
        name = null;
      } else if (indent === 4) {
        section = key;
        name = null;
      } else if (indent === 6) {
        name = key;
      } else if (indent === 8 && name && key === "version") {
        const type = LOCK_SECTIONS.get(section);
        // 只认根 importer（`.`）的三个依赖段；configDependencies 之类直接跳过。
        if (importer === "." && type) {
          found.set(name, { version: cleanVersion(value), type });
        }
      }
    }
  }
  return found;
}

function packageJsonDirectDeps() {
  const pkg = JSON.parse(read("package.json"));
  const found = new Map();
  for (const [key, type] of [
    ["dependencies", "prod"],
    ["devDependencies", "dev"],
    ["optionalDependencies", "prod"],
  ]) {
    for (const name of Object.keys(pkg[key] ?? {})) {
      found.set(name, { range: pkg[key][name], type });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// TPN：「直接依赖明细」的三张表

function noticesDirectDeps(md) {
  const start = md.indexOf("## 直接依赖明细");
  if (start === -1) {
    fail(
      `在 ${NOTICES} 里找不到「## 直接依赖明细」一节 —— 章节改名了就把本脚本一起改。`,
    );
    return new Map();
  }
  const found = new Map();
  // 表格会按列宽补空格，所以每格都按可选空白匹配。
  const row = /^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*(prod|dev)\s*\|/;
  for (const line of md.slice(start).split("\n")) {
    const match = row.exec(line);
    if (!match) continue;
    const [, name, version, type] = match;
    if (found.has(name))
      fail(`${NOTICES} 的「直接依赖明细」里 ${name} 出现了两次。`);
    found.set(name, { version: version.trim(), type });
  }
  return found;
}

// 表头写的「N 个 dependencies + M 个 devDependencies，共 K 个」是给人看的，
// 但没人会记得改，所以一并核对（措辞变了就报错，别让检查悄悄失效）。
function checkDeclaredCounts(md, pkg) {
  const match =
    /(\d+)\s*个\s*`dependencies`\s*\+\s*(\d+)\s*个\s*`devDependencies`，共\s*(\d+)\s*个/.exec(
      md,
    );
  if (!match) {
    fail(
      `在 ${NOTICES} 的「直接依赖明细」里找不到「N 个 \`dependencies\` + M 个 \`devDependencies\`」那句 —— 措辞改了就把本脚本一起改。`,
    );
    return;
  }
  const [, deps, devDeps, total] = match.map(Number);
  const actual = [
    Object.keys(pkg.dependencies ?? {}).length,
    Object.keys(pkg.devDependencies ?? {}).length,
  ];
  if (
    deps !== actual[0] ||
    devDeps !== actual[1] ||
    total !== actual[0] + actual[1]
  ) {
    fail(
      `${NOTICES} 写的是 ${deps} 个 dependencies + ${devDeps} 个 devDependencies（共 ${total} 个），` +
        `package.json 是 ${actual[0]} + ${actual[1]}（共 ${actual[0] + actual[1]}）。`,
    );
  }
}

// ---------------------------------------------------------------------------
// 许可

function pnpmLicenses(args) {
  try {
    return execFileSync("pnpm", ["licenses", "list", ...args, "--json"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      // Windows 上 pnpm 是 .cmd 垫片，得走 shell。
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    fail(
      `跑 \`pnpm licenses list ${args.join(" ")}\` 失败 —— 先 \`pnpm install --frozen-lockfile\`。\n` +
        String(error.stderr ?? error.message).trim(),
    );
    return null;
  }
}

function licenseDistribution(json) {
  const grouped = JSON.parse(json);
  let entries = 0;
  let versions = 0;
  const ids = new Set(Object.keys(grouped));
  for (const list of Object.values(grouped)) {
    entries += list.length;
    for (const entry of list) versions += entry.versions.length;
  }
  return { ids, entries, versions };
}

// 两张分布表第一列列出来的许可标识。只认第二列是数字的行（表头写的是「包数」，
// 合计行的第一列是 `**合计**`），免得把标题和合计当成许可。
function documentedLicenses(md) {
  const ids = new Set();
  for (const [from, to] of [
    ["## 全量依赖树", "## 生产依赖树"],
    ["## 生产依赖树", "## 需要单独说明的许可"],
  ]) {
    const start = md.indexOf(from);
    const end = md.indexOf(to, start + from.length);
    if (start === -1 || end === -1) {
      fail(
        `在 ${NOTICES} 里找不到「${from}」到「${to}」之间的一节 —— 章节改名了就把本脚本一起改。`,
      );
      continue;
    }
    for (const line of md.slice(start, end).split("\n")) {
      const match = /^\|\s*([^|*]+?)\s*\|\s*\d+\s*\|/.exec(line);
      if (match) ids.add(match[1]);
    }
  }
  return ids;
}

function checkLicenses(md) {
  const documented = documentedLicenses(md);
  const full = pnpmLicenses([]);
  const prod = pnpmLicenses(["--prod"]);
  if (full === null || prod === null) return;

  const all = licenseDistribution(full);
  const onlyProd = licenseDistribution(prod);

  for (const [label, dist] of [
    ["全量", all],
    ["--prod", onlyProd],
  ]) {
    for (const id of dist.ids) {
      if (!documented.has(id)) {
        fail(
          `${label}依赖树里出现了 ${NOTICES} 两张分布表里没有的许可「${id}」——` +
            `在「全量依赖树」/「生产依赖树」表里补一行，并在「需要单独说明的许可」里说明它有没有义务。`,
        );
      }
      // 双许可（`A AND B` / `A OR B`）能不能挑宽松的那支是人的判断，这里不代做。
      if (/[(]|[)]|\s(?:AND|OR)\s/.test(id)) continue;
      if (STRONG_COPYLEFT.test(id)) {
        fail(
          `${label}依赖树里出现了强 copyleft 许可「${id}」，而 ${NOTICES} 明写「没有 GPL、AGPL、SSPL 这类强 copyleft 许可」。` +
            `要么换掉这个依赖，要么由人来重新评估并改写那句话。`,
        );
      }
    }
  }

  // 包数按平台可选依赖计，只打印不比对（见文件开头）。
  console.log(
    `许可（本机实测，参考用）：全量 ${all.entries} 条 / ${all.versions} 个版本，` +
      `${all.ids.size} 种许可；--prod ${onlyProd.entries} 条 / ${onlyProd.versions} 个版本，` +
      `${onlyProd.ids.size} 种许可。`,
  );
}

// ---------------------------------------------------------------------------

const md = read(NOTICES);

// --- 1. 版本表 ↔ 锁文件 ---
const locked = lockfileDirectDeps();
const declaredPkg = packageJsonDirectDeps();
const declaredTpn = noticesDirectDeps(md);

const onlyInLockfile = [...locked.keys()].filter(
  (name) => !declaredPkg.has(name),
);
const onlyInPackageJson = [...declaredPkg.keys()].filter(
  (name) => !locked.has(name),
);
if (onlyInLockfile.length > 0 || onlyInPackageJson.length > 0) {
  fail(
    "package.json 与 pnpm-lock.yaml 的直接依赖对不上 —— 先跑 `pnpm install --frozen-lockfile`，" +
      "锁文件确实该更新时再跑 `pnpm install` 并提交新的 pnpm-lock.yaml。\n" +
      `  只在锁文件里：${onlyInLockfile.join(", ") || "（无）"}\n` +
      `  只在 package.json 里：${onlyInPackageJson.join(", ") || "（无）"}`,
  );
}

for (const [name, { version, type }] of locked) {
  const declared = declaredTpn.get(name);
  if (!declared) {
    fail(`${name} 是直接依赖，但 ${NOTICES} 的「直接依赖明细」里没有它。`);
    continue;
  }
  if (declared.version !== version) {
    fail(
      `${name}：${NOTICES} 写 ${declared.version}，pnpm-lock.yaml 是 ${version}。`,
    );
  }
  if (declared.type !== type) {
    fail(
      `${name}：${NOTICES} 标成 ${declared.type}，package.json 里是 ${type}。`,
    );
  }
}

for (const name of declaredTpn.keys()) {
  if (!locked.has(name)) {
    fail(
      `${name} 在 ${NOTICES} 的「直接依赖明细」里，但已经不是直接依赖了 —— 删掉这一行。`,
    );
  }
}

checkDeclaredCounts(md, JSON.parse(read("package.json")));

// --- 2. 许可 ↔ pnpm licenses list ---
checkLicenses(md);

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`${NOTICES} 与实际依赖漂移了 ${failures.length} 处：\n`);
  for (const message of failures) console.error(`- ${message}`);
  console.error(
    `\n改法见 ${NOTICES} 末尾的「复现与维护」一节；改完再跑一次 \`pnpm notices:check\`。`,
  );
  process.exit(1);
}

console.log(
  `${NOTICES} 与 pnpm-lock.yaml 一致：${locked.size} 个直接依赖的版本与依赖类型都对得上，` +
    "许可也都是文件里写过的、没有强 copyleft。",
);
