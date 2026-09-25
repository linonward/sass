#!/usr/bin/env bash
# 列出业务项目对套件目录（默认 src/core）的改动，合并上游之前先看冲突范围。
#
# 用法：scripts/core-drift.sh [remote] [branch]    默认 upstream main
#       CORE_PATHS="src/core src/app/[locale]/(marketing)" scripts/core-drift.sh
#
# 输出三部分（都相对于本分支与上游的分叉点 merge-base）：
#   1. 本项目改过的套件文件（含未提交的改动）
#   2. 上游改过的套件文件
#   3. 两边都改过的文件：合并时最可能冲突
set -euo pipefail

remote="${1:-upstream}"
branch="${2:-main}"
read -r -a paths <<< "${CORE_PATHS:-src/core}"

if ! git remote get-url "$remote" > /dev/null 2>&1; then
  echo "找不到远程仓库 \"$remote\"。先添加上游：git remote add upstream <模板仓库地址>" >&2
  exit 1
fi

git fetch --quiet "$remote" "$branch"
upstream="$remote/$branch"
base="$(git merge-base HEAD "$upstream")"

ours="$(git diff --name-only "$base" -- "${paths[@]}")"
theirs="$(git diff --name-only "$base" "$upstream" -- "${paths[@]}")"

section() {
  printf '\n== %s ==\n' "$1"
  if [ -n "$2" ]; then printf '%s\n' "$2"; else echo "（无）"; fi
}

echo "套件目录：${paths[*]}"
echo "分叉点：$(git log -1 --format='%h %s (%cs)' "$base")"
echo "上游：$upstream $(git log -1 --format='%h (%cs)' "$upstream")"

section "本项目改过的套件文件（含未提交的改动）" \
  "$(git diff --stat "$base" -- "${paths[@]}")"
section "上游改过的套件文件" \
  "$(git diff --stat "$base" "$upstream" -- "${paths[@]}")"
section "两边都改过（合并时最可能冲突）" \
  "$(comm -12 <(printf '%s\n' "$ours" | sed '/^$/d' | sort) <(printf '%s\n' "$theirs" | sed '/^$/d' | sort))"

if [ -z "$ours" ]; then
  printf '\n本项目没有改过套件目录，可以直接 git merge %s。\n' "$upstream"
fi
