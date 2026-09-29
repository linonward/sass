#!/usr/bin/env bash
# Lists your project's changes to the kit directories (default src/core) so you can see the conflict
# surface before merging upstream.
#
# Usage: scripts/core-drift.sh [remote] [branch]    default upstream main
#        CORE_PATHS="src/core src/app/[locale]/(marketing)" scripts/core-drift.sh
#
# Output has three parts (all relative to the merge-base of this branch and upstream):
#   1. kit files this project changed (including uncommitted changes)
#   2. kit files upstream changed
#   3. files changed on both sides: the most likely merge conflicts
set -euo pipefail

remote="${1:-upstream}"
branch="${2:-main}"
read -r -a paths <<< "${CORE_PATHS:-src/core}"

if ! git remote get-url "$remote" > /dev/null 2>&1; then
  echo "Remote \"$remote\" not found. Add upstream first: git remote add upstream <template repo URL>" >&2
  exit 1
fi

git fetch --quiet "$remote" "$branch"
upstream="$remote/$branch"
base="$(git merge-base HEAD "$upstream")"

ours="$(git diff --name-only "$base" -- "${paths[@]}")"
theirs="$(git diff --name-only "$base" "$upstream" -- "${paths[@]}")"

section() {
  printf '\n== %s ==\n' "$1"
  if [ -n "$2" ]; then printf '%s\n' "$2"; else echo "(none)"; fi
}

echo "Kit directories: ${paths[*]}"
echo "Merge base: $(git log -1 --format='%h %s (%cs)' "$base")"
echo "Upstream: $upstream $(git log -1 --format='%h (%cs)' "$upstream")"

section "Kit files this project changed (including uncommitted changes)" \
  "$(git diff --stat "$base" -- "${paths[@]}")"
section "Kit files upstream changed" \
  "$(git diff --stat "$base" "$upstream" -- "${paths[@]}")"
section "Changed on both sides (most likely merge conflicts)" \
  "$(comm -12 <(printf '%s\n' "$ours" | sed '/^$/d' | sort) <(printf '%s\n' "$theirs" | sed '/^$/d' | sort))"

if [ -z "$ours" ]; then
  printf '\nThis project has not changed the kit directories; you can git merge %s directly.\n' "$upstream"
fi
