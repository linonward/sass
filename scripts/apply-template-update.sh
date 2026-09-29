#!/usr/bin/env bash
# 买家侧：把模板的差量更新包应用到自己的仓库。
#
# 用法：
#   scripts/apply-template-update.sh <更新包.zip 或解压后的目录>
#   scripts/apply-template-update.sh --resolved <路径> [--resolved <路径>…] <更新包>
#   scripts/apply-template-update.sh --migrations-done <更新包>
#
# 逐文件三路合并：base = 更新包里的旧版副本，ours = 你现在的文件，theirs = 新版。
#
#   · 模板改了、你没改   → 直接取新版
#   · 两边都改了、合得上 → 自动合并
#   · 两边都改了、合不上 → 文件里留下冲突标记，脚本列出文件并非零退出
#   · 模板删除的文件     → 只提示，不替你删
#   · 你删掉的文件       → 跳过，不替你恢复
#
# 脚本**不碰 git 历史**：合并结果留在工作区，你自己看一眼再提交。
#
# 有冲突或迁移没处理完时，版本基线（template.json）**不会**推进 —— 下次更新靠它接上，
# 提前推进会让这次没落地的改动永远补不回来。你把它们处理完之后，用下面两个参数
# 告诉脚本「这块我处理过了」，重跑一次基线才会推上去（已经应用过的文件会跳过，重复跑是安全的）：
#
#   --resolved <路径>    这个文件我手工解决过了，保留我的，别再动它（可重复）
#   --migrations-done    迁移按脚本打印的步骤处理完了（只在迁移真的被拦下时生效）
#
# 需要 git（用 `git merge-file` 做三路合并）与 node（读清单）。
set -euo pipefail

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
用法：
  scripts/apply-template-update.sh <更新包.zip 或解压后的目录>
  scripts/apply-template-update.sh --resolved <路径> [--resolved <路径>…] <更新包>
  scripts/apply-template-update.sh --migrations-done <更新包>

  --resolved <路径>   你已手工解决过这个文件的冲突，保留你的、别再动它（可重复）
  --migrations-done   迁移已按脚本打印的步骤处理完（只在迁移确实被拦下时有意义）
EOF
}

update=""
resolved=()
migrations_done=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --resolved)
      [ -n "${2:-}" ] || die "--resolved 后面要跟路径。"
      resolved+=("$2")
      shift 2
      ;;
    --migrations-done)
      migrations_done=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*)
      die "不认识的参数：$1（--help 看用法）"
      ;;
    *)
      [ -z "$update" ] || die "只接受一个更新包，收到两个：$update 和 $1"
      update="$1"
      shift
      ;;
  esac
done
[ -n "$update" ] || die "没给更新包。用法见 --help。"

is_resolved() {
  local p="$1" r
  for r in ${resolved[@]+"${resolved[@]}"}; do
    [ "$p" = "$r" ] && return 0
  done
  return 1
}

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

command -v git >/dev/null 2>&1 || die "需要 git：三路合并用的是 git merge-file。"
command -v node >/dev/null 2>&1 || die "需要 node：更新包的清单是它读的。"
[ -f template.json ] ||
  die "当前目录没有 template.json —— 更新包靠它确认起点版本，发行包里带着这个文件。"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
results="$workdir/results"
mkdir -p "$results"

# 传 zip 或已解压的目录都行
if [ -d "$update" ]; then
  src="$(cd "$update" && pwd)"
else
  [ -f "$update" ] || die "找不到 $update"
  unzip -q "$update" -d "$workdir/unpacked"
  src="$(find "$workdir/unpacked" -mindepth 1 -maxdepth 1 -type d | head -1)"
  [ -n "$src" ] || die "$update 里没有目录，看起来不是更新包。"
fi
[ -f "$src/update.json" ] || die "$update 里没有 update.json —— 这不是本脚本认识的更新包。"

# 清单：第一行是 from / to，之后每行是 status / mode / path
node -e '
  const fs = require("fs");
  const u = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write([u.from, u.to].join("\t") + "\n");
  for (const f of u.files) process.stdout.write([f.status, f.mode || "", f.path].join("\t") + "\n");
' "$src/update.json" >"$workdir/files.tsv"

from_ver="$(head -1 "$workdir/files.tsv" | cut -f1)"
to_ver="$(head -1 "$workdir/files.tsv" | cut -f2)"
tail -n +2 "$workdir/files.tsv" >"$workdir/changes.tsv"
cut -f3 "$workdir/changes.tsv" | grep '^drizzle/' >"$results/drizzle-in-update" || true

buyer_ver="$(node -p 'JSON.parse(require("fs").readFileSync("template.json","utf8")).version')"
printf '当前版本：%s\n更新包：%s → %s\n\n' "$buyer_ver" "$from_ver" "$to_ver"

if [ "$buyer_ver" != "$from_ver" ]; then
  die "版本对不上：你手里是 $buyer_ver，这个更新包要求起点 $from_ver。
更新包要按顺序应用 —— 先应用上一个版本的更新包，再应用这个。"
fi

printf '提示：脚本直接改工作区里的文件、不碰 git 历史。建议先提交或备份当前改动，方便比对与回退。\n'

# 你自上个版本以来动过哪些迁移？拿 template.json 的清单（上一个版本的哈希）比。
node -e '
  const fs = require("fs"), crypto = require("crypto"), path = require("path");
  const manifest = JSON.parse(fs.readFileSync("template.json", "utf8")).files || {};
  const walk = (d) =>
    fs.existsSync(d)
      ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
          const p = path.join(d, e.name);
          return e.isDirectory() ? walk(p) : [p];
        })
      : [];
  const now = new Set(walk("drizzle").map((p) => p.split(path.sep).join("/")));
  const out = [];
  for (const [rel, hash] of Object.entries(manifest)) {
    if (!rel.startsWith("drizzle/")) continue;
    if (!now.has(rel)) {
      out.push(rel + "（你删了）");
      continue;
    }
    const h = crypto.createHash("sha256").update(fs.readFileSync(rel)).digest("hex");
    if (h !== hash) out.push(rel + "（你改了）");
    now.delete(rel);
  }
  for (const extra of now) out.push(extra + "（你新增的）");
  process.stdout.write(out.join("\n"));
' >"$results/migrations-touched"

# 两边都动了迁移：整块交给人工，绝不静默覆盖（模板会新增迁移，买家也会）。
migration_manual=0
if [ -s "$results/migrations-touched" ] && [ -s "$results/drizzle-in-update" ]; then
  migration_manual=1
fi

# 两个文件内容一致（都不存在也算一致）
same() {
  if [ ! -e "$1" ] && [ ! -e "$2" ]; then return 0; fi
  [ -f "$1" ] && [ -f "$2" ] && cmp -s "$1" "$2"
}

set_mode() {
  if [ "$2" = "100755" ]; then chmod +x "$1"; fi
}

# 三路合并。0 = 干净，1–127 = 冲突个数，其余（验证不了的退出码）= 合不了（多半是二进制）。
merge_three() { # <base> <ours> <theirs>
  local base="$1" ours="$2" theirs="$3" out status=0
  out="$(mktemp)"
  git merge-file -p -L "你现在的版本" -L "模板上一版" -L "模板新版" \
    "$ours" "$base" "$theirs" >"$out" 2>/dev/null || status=$?
  if [ "$status" -eq 0 ]; then
    cat "$out" >"$ours"
    printf '%s\n' "$ours" >>"$results/merged"
  elif [ "$status" -le 127 ]; then
    # 带着冲突标记落回工作区，交给人看
    cat "$out" >"$ours"
    printf '%s\n' "$ours" >>"$results/conflicted"
  else
    # 合不了：你的文件原样不动，新版另存一份，人工决定
    cp "$theirs" "$ours.template-new"
    printf '%s\n' "$ours" >>"$results/unmergeable"
  fi
  rm -f "$out"
}

while IFS=$'\t' read -r status mode_bits path; do
  [ -n "$path" ] || continue

  # 买家说「这个我处理过了」的路径一律不动 —— 手工解决过冲突的文件再跑三路合并
  # 只会把标记写回去，版本基线就永远推不上去了。
  if is_resolved "$path"; then
    printf '%s\n' "$path" >>"$results/kept"
    continue
  fi

  case "$path" in
    drizzle/*)
      if [ "$migration_manual" = 1 ]; then
        if [ "$migrations_done" = 1 ]; then
          printf '%s\n' "$path" >>"$results/kept"
        else
          printf '%s\n' "$path" >>"$results/held"
        fi
        continue
      fi
      ;;
  esac

  case "$status" in
    added)
      if [ ! -e "$path" ]; then
        mkdir -p "$(dirname "$path")"
        cp "$src/new/$path" "$path"
        set_mode "$path" "$mode_bits"
        printf '%s\n' "$path" >>"$results/applied"
      elif same "$path" "$src/new/$path"; then
        printf '%s\n' "$path" >>"$results/uptodate"
      else
        # 两边各自新增了同一个文件：没有共同祖先，整段算冲突
        merge_three /dev/null "$path" "$src/new/$path"
      fi
      ;;
    modified)
      if [ ! -e "$path" ]; then
        printf '%s\n' "$path" >>"$results/removed-by-you"
      elif same "$path" "$src/base/$path"; then
        cp "$src/new/$path" "$path"
        set_mode "$path" "$mode_bits"
        printf '%s\n' "$path" >>"$results/applied"
      elif same "$path" "$src/new/$path"; then
        printf '%s\n' "$path" >>"$results/uptodate"
      else
        merge_three "$src/base/$path" "$path" "$src/new/$path"
      fi
      ;;
    deleted)
      printf '%s\n' "$path" >>"$results/deleted-by-template"
      ;;
    *)
      die "不认识的变动类型：$status $path"
      ;;
  esac
done <"$workdir/changes.tsv"

report() { # <标题> <结果文件名>
  local title="$1" file="$results/$2"
  [ -s "$file" ] || return 0
  printf '%s（%s）\n' "$title" "$(wc -l <"$file" | tr -d ' ')"
  sed 's/^/  · /' "$file"
  printf '\n'
}

printf '\n'
report "已经取新版" applied
report "自动合并" merged
report "冲突：已留下冲突标记，需要你手工解决" conflicted
report "合不了（多半是二进制），你的文件没动、新版另存为 *.template-new" unmergeable
report "模板删除了这些文件，没有替你删" deleted-by-template
report "迁移相关，本次未处理" held
report "你删掉的模板文件，跳过不恢复" removed-by-you
report "已经是新版，跳过" uptodate
report "按你说的保留原样（--resolved / --migrations-done）" kept

if [ -s "$results/conflicted" ] || [ -s "$results/unmergeable" ]; then
  printf '冲突文件里搜 `<<<<<<<` 就能看到两边；模板的新版在更新包的 new/<路径>，你的原版在 base/<路径>。\n'
  printf '解决完之后，把你解决过的路径告诉脚本，重跑一次（同一个更新包）：\n\n'
  printf '  scripts/apply-template-update.sh --resolved <路径> [--resolved <路径>…] %s\n\n' "$update"
fi

if [ -s "$results/held" ]; then
  printf '迁移需要你手动处理，本次没有动 drizzle/ 下的任何文件。\n\n'
  printf '你这边动过的迁移：\n'
  sed 's/^/  · /' "$results/migrations-touched"
  printf '\n模板这次带来的迁移都在更新包的 new/drizzle/ 下。处理步骤（细节见 UPGRADING.md）：\n\n'
  printf '  1. 你自己的迁移保留原编号，模板的迁移文件按原名放进 drizzle/。\n'
  printf '  2. 编号撞车时保留模板那条的编号，重新生成你自己的那一条：\n'
  printf '       pnpm db:generate --name <你原来那条的名字>\n'
  printf '     生成的迁移只应包含你自己的表。\n'
  printf '  3. pnpm migrations:check   # 编号连续、when 严格递增\n'
  printf '     pnpm db:migrate         # 先在一个 Neon 分支或本地库上验证\n'
  printf '  4. 处理完加 --migrations-done 重跑一次（同一个更新包）：\n\n'
  printf '       scripts/apply-template-update.sh --migrations-done %s\n\n' "$update"
fi

if [ -s "$results/conflicted" ] || [ -s "$results/unmergeable" ] || [ -s "$results/held" ]; then
  printf '版本基线仍是 %s（没有推进）：这次没落地的改动，靠它下次还能补上。\n' "$buyer_ver"
  printf '把上面几项处理干净、按要求重跑之后，基线才会推到 %s。\n' "$to_ver"
  exit 1
fi

# 全部干净：把版本基线推到新版本，下次更新从这里接上。
cp "$src/new/template.json" template.json

printf '更新完成：%s → %s\n\n' "$from_ver" "$to_ver"
cat <<'EOF'
下一步：

  pnpm install     # 依赖可能变了（package.json / pnpm-lock.yaml）
  git diff         # 看一眼这次更新改了什么
  pnpm test        # 单测；没配 DATABASE_URL_TEST 时数据库用例会跳过
  pnpm db:migrate  # 有新迁移才需要；先在一个 Neon 分支或本地库上跑

确认没问题后自己提交（脚本不碰 git 历史）：
  git add -A && git commit -m "chore: apply template update"
EOF