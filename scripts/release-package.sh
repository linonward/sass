#!/usr/bin/env bash
# 打「买家分发包」：一个可以直接交给买家的 zip，外加一遍自检。
#
# 为什么必须走 git archive 而不是 `zip -r .`：包里绝不能出现未跟踪的东西 ——
# `.env.local` 里有真实凭据，`.vercel/` 是部署关联，`.next/`、`test-results/`
# 是构建与测试产物。`git archive` 只导出**被跟踪**的文件，这些天然进不去；
# 手工 zip 则会把它们一起打进去。这是这个脚本存在的唯一理由。
#
# 在 archive 之上再显式剔除内部文档（任务表、计划、流程、AGENTS/CLAUDE 说明），
# 然后解压自检：凭据、卖家域名、内部文档、内部任务编号必须零命中，缺文件或漏剔除就非零退出。
#
# 两种产物，共用同一套排除清单、同一份自检：
#
#   scripts/release-package.sh [ref]                 主包（默认 HEAD）
#   scripts/release-package.sh --update <from> <to>  差量更新包
#
# 主包和更新包里都有一份 template.json：版本、提交、构建时间，以及每个随包文件的
# sha256。买家靠它确认手里这份是哪个版本，更新包靠它校验起点（见
# scripts/apply-template-update.sh）。
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

# 内部文档：买家拿到的是产品，不是这套模板的开发过程。
# 这份清单是**唯一口径**：git archive 的排除、自检的 find、清单自检都从它派生。
exclude_paths=(
  AGENTS.md
  CLAUDE.md
  docs/plan.md
  docs/workflow.md
  docs/tasks
  docs/go-to-market.md
  docs/competitive-landscape.md
)
excludes=()
for p in "${exclude_paths[@]}"; do excludes+=(":(exclude)$p"); done

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

# 版本串：ref 上有精确 tag 就用 tag，否则用该 ref 的 package.json 版本 + 短 sha。
# tag 是对外版本号的正规来源；没有 tag 的提交（本地演练、CI）也要能出包，所以留回退。
version_of() {
  local ref="$1" tag
  tag="$(git describe --tags --exact-match "$ref" 2>/dev/null || true)"
  if [ -n "$tag" ]; then
    printf '%s\n' "$tag"
  else
    printf '%s-%s\n' \
      "$(git show "$ref:package.json" | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).version')" \
      "$(git rev-parse --short "$ref")"
  fi
}

# 文件名里只留安全字符
sanitize() { printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '-'; }

# 生成包里的 template.json：版本基线 + 每个随包文件的 sha256。
# 清单不含 template.json 自己（算不出自己的哈希）；被排除的路径由自检兜着。
write_template_json() { # <包目录> <版本串> <ref>
  node -e '
    const fs = require("fs"), path = require("path"), crypto = require("crypto");
    const [dir, version, ref] = process.argv.slice(1);
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(d, e.name);
      return e.isDirectory() ? walk(p) : [p];
    });
    const files = {};
    for (const f of walk(dir).sort()) {
      const rel = path.relative(dir, f).split(path.sep).join("/");
      if (rel === "template.json") continue;
      files[rel] = crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
    }
    process.stdout.write(JSON.stringify(
      { name: "sass-template", version, ref, builtAt: new Date().toISOString(), files }, null, 2) + "\n");
  ' "$1" "$2" "$3" >"$1/template.json"
}

# 从 ref 里导出单个文件到目录（保留 git 里的可执行位）。
export_file() { # <ref> <路径> <目标目录> <mode>
  local dir="$3"
  mkdir -p "$dir/$(dirname "$2")"
  git show "$1:$2" >"$dir/$2"
  if [ "$4" = "100755" ]; then chmod +x "$dir/$2"; fi
}

# 命中就打印并记失败；没命中打一行 ✓。
check() {
  local label="$1"
  shift
  local hits
  hits="$("$@" || true)"
  if [ -n "$hits" ]; then
    printf '✗ %s\n%s\n' "$label" "$hits"
    fail=1
  else
    printf '✓ %s\n' "$label"
  fi
}

# 自检：传一份解开的包目录。主包传包根、require_files=1；更新包传 staging 根、
# require_files=0 —— 更新包里只有变动文件，天然没有 README 这类必备文件。
selfcheck() {
  local dir="$1" require_files="$2"
  fail=0

  if [ "$require_files" = 1 ]; then
    for required in README.md LICENSE package.json .env.example pnpm-lock.yaml \
      src e2e scripts drizzle messages content site.config.ts UPGRADING.md \
      docs/starter-guide.md template.json; do
      if [ ! -e "$dir/$required" ]; then
        printf '✗ 缺少 %s\n' "$required"
        fail=1
      fi
    done
  fi

  check "没有 .env 系列文件（.env.example 除外）" \
    find "$dir" -name ".env*" ! -name ".env.example"
  check "没有构建产物、依赖和本地临时目录" \
    find "$dir" -maxdepth 3 \
    \( -name ".vercel" -o -name "node_modules" -o -name ".next" \
    -o -name ".content-collections" -o -name "test-results" \
    -o -name "playwright-report" -o -name ".tmp" \)
  check "没有内部文档（AGENTS / CLAUDE / 计划 / 流程 / 任务表 / 市场策略）" \
    find "$dir" \( "${doc_find[@]}" \)
  # 卖家痕迹：域名和邮箱一律不许出现。上游仓库地址是例外 —— README / UPGRADING
  # 教买家把它加为 upstream 以合并模板更新，那是买家需要的。
  # 模式写成 `[.]` / `[@]` 而不是 `\.` / `@`：否则脚本自己的源码会命中自己，
  # 失败输出里多一行无关的噪音。
  check "没有卖家域名或邮箱" \
    grep -rIl -e "linonward[.]com" -e "[@]linonward" "$dir"

  # 内部任务编号（T + 三位数字）只在本仓库的任务表里有解释，而任务表不随包交付。
  # 主包扫下面这组路径：上面的必备文件检查保证它们存在，不会因为路径缺失退化成假绿
  # —— 脚本注释里写任务号正是容易漏的地方，所以 scripts 也在内。
  # 更新包里这些路径可能整个不存在，所以扫整棵树，只排掉 pnpm-lock.yaml ——
  # integrity 的 base64 里会随机出现这个形状，那是假命中。
  # 这条注释本身也不能写出那个形状（跟上面域名模式的道理一样）：scripts/ 在主包的
  # 扫描范围内，注释里留一个样例就会让自检命中自己。
  if [ "$require_files" = 1 ]; then
    check "没有内部任务编号（T###）" \
      grep -rInE "T[0-9]{3}" "$dir/src" "$dir/e2e" "$dir/scripts" \
      "$dir/drizzle" "$dir/messages" "$dir/content" \
      "$dir/site.config.ts" "$dir/README.md" "$dir/UPGRADING.md" \
      "$dir/docs/starter-guide.md"
  else
    check "没有内部任务编号（T###，更新包全树）" \
      grep -rInE --exclude=pnpm-lock.yaml "T[0-9]{3}" "$dir/new" "$dir/base"
  fi

  return "$fail"
}

# template.json 的清单里不能出现被排除的路径 —— 那意味着某个内部文档混进了包。
manifest_leak() { # <template.json> <被排除的路径…>
  local mf="$1" p
  shift
  for p in "$@"; do
    if grep -qE "^[[:space:]]*\"$p(/|\")" "$mf"; then printf '%s\n' "$p"; fi
  done
  return 0
}

usage() {
  cat <<'EOF'
用法：
  scripts/release-package.sh [ref]                 打主包（默认 HEAD）
  scripts/release-package.sh --update <from> <to>  打差量更新包

产物都在 dist/（已 gitignore）。ref 可以是 tag、分支或提交。
EOF
}

# 内部文档的 find 谓词，从 exclude_paths 派生（见文件头：唯一口径）。
doc_find=()
for p in "${exclude_paths[@]}"; do
  if [ "${#doc_find[@]}" -gt 0 ]; then doc_find+=(-o); fi
  doc_find+=(-path "*/$p" -o -path "*/$p/*")
done

mode=pack
from=""
to=""
case "${1:-}" in
  --update)
    mode=update
    from="${2:-}"
    to="${3:-}"
    [ -n "$from" ] && [ -n "$to" ] || die "用法：scripts/release-package.sh --update <from> <to>"
    ;;
  --help | -h)
    usage
    exit 0
    ;;
  "") ;;
  *) ref="$1" ;;
esac

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
mkdir -p dist

if [ "$mode" = pack ]; then
  ref="${ref:-HEAD}"
  version="$(version_of "$ref")"
  name="sass-template-$(sanitize "$version")"
  out="$root/dist/$name.zip"

  git archive --format=zip --prefix="$name/" -o "$out" "$ref" -- . "${excludes[@]}"

  unzip -q "$out" -d "$workdir"
  pkg="$workdir/$name"

  # template.json 在 archive 之后生成，再追加进包里：包的其余条目仍是 git archive
  # 的原样字节（权限位、时间戳都不动），「只导出被跟踪文件」这条前提也不变。
  write_template_json "$pkg" "$version" "$ref"
  (cd "$workdir" && zip -q "$out" "$name/template.json")

  selfcheck "$pkg" 1 || true
  check "template.json 清单里没有被排除的路径" manifest_leak "$pkg/template.json" "${exclude_paths[@]}"

  upstream="$(grep -rIoE "github\.com/linonward/sass" "$pkg" | wc -l | tr -d ' ')"

  printf '\n包：%s（%s，%s 个文件）\n版本：%s\n' \
    "$out" \
    "$(du -h "$out" | cut -f1)" \
    "$(find "$pkg" -type f | wc -l | tr -d ' ')" \
    "$version"
  printf '上游仓库地址出现 %s 次（合并模板更新用，属预期）\n' "$upstream"

  if [ "$fail" -ne 0 ]; then
    printf '\n自检未通过，别把这个包发出去。\n' >&2
    exit 1
  fi

  printf '自检通过：%s\n' "$out"
  exit 0
fi

# ---- 差量更新包 ----
from_ver="$(version_of "$from")"
to_ver="$(version_of "$to")"
name="sass-template-update-$(sanitize "$from_ver")-to-$(sanitize "$to_ver")"
out="$root/dist/$name.zip"
pkg="$workdir/$name"
mkdir -p "$pkg/new" "$pkg/base"

# 变动清单：同一套排除；不跟踪重命名（改名以「删 + 增」出现，比猜重命名安全）。
changed="$(git diff --name-status --no-renames "$from" "$to" -- . "${excludes[@]}")"
[ -n "$changed" ] || die "两个 ref 之间没有随包文件的变动，不出更新包（$from_ver → $to_ver）。"

: >"$workdir/files.tsv"
while IFS=$'\t' read -r st path; do
  mode_bits="$(git ls-tree "$to" -- "$path" | cut -d' ' -f1)"
  [ -n "$mode_bits" ] || mode_bits="$(git ls-tree "$from" -- "$path" | cut -d' ' -f1)"
  case "$st" in
    A)
      export_file "$to" "$path" "$pkg/new" "$mode_bits"
      status=added
      ;;
    M)
      export_file "$from" "$path" "$pkg/base" "$mode_bits"
      export_file "$to" "$path" "$pkg/new" "$mode_bits"
      status=modified
      ;;
    D)
      export_file "$from" "$path" "$pkg/base" "$mode_bits"
      status=deleted
      ;;
    *) die "不认识的变动类型：$st $path" ;;
  esac
  printf '%s\t%s\t%s\n' "$status" "$mode_bits" "$path" >>"$workdir/files.tsv"
done <<<"$changed"

# 新版本的 template.json：与主包同一份生成逻辑。买家应用完更新后接手它，
# 下一次更新的起点就是它 —— 所以它必须描述**完整**的新版本，而不只是变动文件。
mkdir -p "$workdir/full"
git archive --format=tar "$to" -- . "${excludes[@]}" | tar -x -C "$workdir/full"
write_template_json "$workdir/full" "$to_ver" "$to"
cp "$workdir/full/template.json" "$pkg/new/template.json"

node -e '
  const fs = require("fs");
  const [stage, name, fromV, toV, fromRef, toRef] = process.argv.slice(1);
  const files = fs.readFileSync(stage + "/files.tsv", "utf8").trim().split("\n").filter(Boolean).map((l) => {
    const [status, mode, path] = l.split("\t");
    return { path, status, mode };
  });
  fs.writeFileSync(stage + "/update.json", JSON.stringify({
    name, from: fromV, to: toV, fromRef, toRef,
    builtAt: new Date().toISOString(), baseline: "new/template.json", files,
  }, null, 2) + "\n");
' "$workdir" "$name" "$from_ver" "$to_ver" "$(git rev-parse "$from")" "$(git rev-parse "$to")"
mv "$workdir/update.json" "$pkg/update.json"

changes="$(cut -f1 "$workdir/files.tsv" | sort | uniq -c | tr -s ' ' | tr '\n' ' ')"
rm -f "$workdir/files.tsv"

selfcheck "$pkg" 0 || true
check "template.json 清单里没有被排除的路径" manifest_leak "$pkg/new/template.json" "${exclude_paths[@]}"

(cd "$workdir" && zip -qr "$out" "$name")

printf '\n更新包：%s（%s，%s 个文件）\n%s → %s\n' \
  "$out" \
  "$(du -h "$out" | cut -f1)" \
  "$(find "$pkg" -type f | wc -l | tr -d ' ')" \
  "$from_ver" "$to_ver"
printf '变动：%s\n' "$changes"

if [ "$fail" -ne 0 ]; then
  printf '\n自检未通过，别把这个包发出去。\n' >&2
  exit 1
fi

printf '自检通过：%s\n' "$out"