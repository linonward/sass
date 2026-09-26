#!/usr/bin/env bash
# 打「买家分发包」：一个可以直接交给买家的 zip，外加一遍自检。
#
# 为什么必须走 git archive 而不是 `zip -r .`：包里绝不能出现未跟踪的东西 ——
# `.env.local` 里有真实凭据，`.vercel/` 是部署关联，`.next/`、`test-results/`
# 是构建与测试产物。`git archive` 只导出**被跟踪**的文件，这些天然进不去；
# 手工 zip 则会把它们一起打进去。这是这个脚本存在的唯一理由。
#
# 在 archive 之上再显式剔除内部文档（任务表、计划、流程、AGENTS/CLAUDE 说明），
# 然后解压自检：凭据、卖家域名、内部文档必须零命中，缺文件或漏剔除就非零退出。
#
# 用法：scripts/release-package.sh [ref]      默认 HEAD，也可以传 tag
#       scripts/release-package.sh v1.0.0
set -euo pipefail

ref="${1:-HEAD}"
root="$(git rev-parse --show-toplevel)"
cd "$root"

sha="$(git rev-parse --short "$ref")"
name="sass-template-$sha"
out="dist/$name.zip"
mkdir -p dist

# 内部文档：买家拿到的是产品，不是这套模板的开发过程。
excludes=(
  ":(exclude)AGENTS.md"
  ":(exclude)CLAUDE.md"
  ":(exclude)docs/plan.md"
  ":(exclude)docs/workflow.md"
  ":(exclude)docs/tasks"
)

git archive --format=zip --prefix="$name/" -o "$out" "$ref" -- . "${excludes[@]}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
unzip -q "$out" -d "$tmp"
pkg="$tmp/$name"

fail=0

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

# 必须存在的东西：剔多了会打出空壳包，这里挡住。
for required in README.md LICENSE package.json .env.example pnpm-lock.yaml; do
  if [ ! -e "$pkg/$required" ]; then
    printf '✗ 缺少 %s\n' "$required"
    fail=1
  fi
done

check "没有 .env 系列文件（.env.example 除外）" \
  find "$pkg" -name ".env*" ! -name ".env.example"
check "没有构建产物、依赖和本地临时目录" \
  find "$pkg" -maxdepth 2 \
  \( -name ".vercel" -o -name "node_modules" -o -name ".next" \
  -o -name ".content-collections" -o -name "test-results" \
  -o -name "playwright-report" -o -name ".tmp" \)
check "没有内部文档（AGENTS / CLAUDE / 计划 / 流程 / 任务表）" \
  find "$pkg" \
  \( -name "AGENTS.md" -o -name "CLAUDE.md" -o -path "*/docs/tasks*" \
  -o -path "*/docs/plan.md" -o -path "*/docs/workflow.md" \)
# 卖家痕迹：域名和邮箱一律不许出现。上游仓库地址是例外 —— README / UPGRADING
# 教买家把它加为 upstream 以合并模板更新，那是买家需要的。
# 模式写成 `[.]` / `[@]` 而不是 `\.` / `@`：否则脚本自己的源码会命中自己，
# 失败输出里多一行无关的噪音。
check "没有卖家域名或邮箱" \
  grep -rIl -e "linonward[.]com" -e "[@]linonward" "$pkg"

upstream="$(grep -rIoE "github\.com/linonward/sass" "$pkg" | wc -l | tr -d ' ')"

printf '\n包：%s（%s，%s 个文件）\n' \
  "$out" \
  "$(du -h "$out" | cut -f1)" \
  "$(find "$pkg" -type f | wc -l | tr -d ' ')"
printf '上游仓库地址出现 %s 次（合并模板更新用，属预期）\n' "$upstream"

if [ "$fail" -ne 0 ]; then
  printf '\n自检未通过，别把这个包发出去。\n' >&2
  exit 1
fi

printf '自检通过：%s\n' "$out"
