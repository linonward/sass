#!/usr/bin/env bash
# Builds the buyer release package: a zip you can hand straight to a buyer, plus a self-check.
#
# Why this must go through git archive instead of `zip -r .`: nothing untracked may ever end up in
# the package — `.env.local` holds real credentials, `.vercel/` is the deployment link, `.next/` and
# `test-results/` are build and test output. `git archive` exports only **tracked** files, so none of
# these can get in; a hand-made zip would pack them all. That is the sole reason this script exists.
#
# On top of the archive it explicitly strips internal docs (task tables, plan, workflow,
# AGENTS/CLAUDE instructions), then unpacks and self-checks: credentials, seller domains, internal
# docs and internal task IDs must have zero hits; a missing file or a leaked exclusion exits non-zero.
#
# Two kinds of output, sharing the same exclude list and the same self-check:
#
#   scripts/release-package.sh [ref]                 full package (default HEAD)
#   scripts/release-package.sh --update <from> <to>  update package (diff only)
#
# Both the full package and the update package contain a template.json: version, commit, build time,
# and the sha256 of every shipped file. Buyers use it to tell which version they have; the update
# package uses it to verify the starting point (see scripts/apply-template-update.sh).
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

# Internal docs: buyers get the product, not the process of developing this template.
# This list is the **single source of truth**: the git archive excludes, the self-check find and the
# manifest check are all derived from it.
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

# Version string: the exact tag on the ref if there is one, otherwise that ref's package.json version
# plus the short sha. Tags are the canonical source of public version numbers; untagged commits
# (local dry runs, CI) must still be able to produce a package, hence the fallback.
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

# Keep only safe characters in file names
sanitize() { printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '-'; }

# Generates the package's template.json: version baseline + sha256 of every shipped file.
# The manifest leaves out template.json itself (it can't hash itself); excluded paths are caught by
# the self-check.
write_template_json() { # <package dir> <version string> <ref>
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

# Exports a single file from ref into a directory (keeping the executable bit from git).
export_file() { # <ref> <path> <target dir> <mode>
  local dir="$3"
  mkdir -p "$dir/$(dirname "$2")"
  git show "$1:$2" >"$dir/$2"
  if [ "$4" = "100755" ]; then chmod +x "$dir/$2"; fi
}

# On hits, print them and record a failure; otherwise print a single ✓ line.
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

# Self-check: pass an unpacked package directory. The full package passes the package root with
# require_files=1; the update package passes the staging root with require_files=0 — an update
# package only holds changed files, so naturally it lacks required files like README.
selfcheck() {
  local dir="$1" require_files="$2"
  fail=0

  if [ "$require_files" = 1 ]; then
    for required in README.md LICENSE package.json .env.example pnpm-lock.yaml \
      src e2e scripts drizzle messages content site.config.ts UPGRADING.md \
      docs/starter-guide.md docs/agent-guide.md template.json; do
      if [ ! -e "$dir/$required" ]; then
        printf '✗ missing %s\n' "$required"
        fail=1
      fi
    done
  fi

  check "no .env* files (except .env.example)" \
    find "$dir" -name ".env*" ! -name ".env.example"
  check "no build output, dependencies or local temp directories" \
    find "$dir" -maxdepth 3 \
    \( -name ".vercel" -o -name "node_modules" -o -name ".next" \
    -o -name ".content-collections" -o -name "test-results" \
    -o -name "playwright-report" -o -name ".tmp" \)
  check "no internal docs (AGENTS / CLAUDE / plan / workflow / task tables / go-to-market)" \
    find "$dir" \( "${doc_find[@]}" \)
  # Seller traces: domains and email addresses must never appear. The upstream repo URL is the
  # exception — README / UPGRADING tell buyers to add it as upstream to merge template updates, and
  # buyers need that.
  # The patterns are written as `[.]` / `[@]` rather than `\.` / `@`: otherwise the script's own
  # source would match itself and add an irrelevant line of noise to the failure output.
  check "no seller domain or email" \
    grep -rIl -e "linonward[.]com" -e "[@]linonward" "$dir"

  # Internal task IDs (T + three digits) are only explained in this repo's task tables, and the task
  # tables don't ship. The full package scans the paths below: the required-file check above
  # guarantees they exist, so a missing path can't degrade into a false green — script comments are
  # exactly where task IDs tend to slip through, so scripts is included.
  # In an update package these paths may not exist at all, so it scans the whole tree, excluding
  # only pnpm-lock.yaml — that shape shows up at random in the integrity base64, a false hit.
  # This comment must not spell out that shape either (same reasoning as the domain patterns above):
  # scripts/ is in the full package's scan scope, so an example here would make the check hit itself.
  if [ "$require_files" = 1 ]; then
    check "no internal task IDs (T###)" \
      grep -rInE "T[0-9]{3}" "$dir/src" "$dir/e2e" "$dir/scripts" \
      "$dir/drizzle" "$dir/messages" "$dir/content" \
      "$dir/site.config.ts" "$dir/README.md" "$dir/UPGRADING.md" \
      "$dir/docs/starter-guide.md" "$dir/docs/agent-guide.md"
  else
    check "no internal task IDs (T###, whole update package tree)" \
      grep -rInE --exclude=pnpm-lock.yaml "T[0-9]{3}" "$dir/new" "$dir/base"
  fi

  return "$fail"
}

# Excluded paths must not appear in the template.json manifest — that would mean an internal doc
# slipped into the package.
manifest_leak() { # <template.json> <excluded paths…>
  local mf="$1" p
  shift
  for p in "$@"; do
    if grep -qE "^[[:space:]]*\"$p(/|\")" "$mf"; then printf '%s\n' "$p"; fi
  done
  return 0
}

usage() {
  cat <<'EOF'
Usage:
  scripts/release-package.sh [ref]                 build the full package (default HEAD)
  scripts/release-package.sh --update <from> <to>  build an update package (diff only)

Output goes to dist/ (gitignored). ref can be a tag, a branch or a commit.
EOF
}

# find predicates for internal docs, derived from exclude_paths (see the header: single source of
# truth).
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
    [ -n "$from" ] && [ -n "$to" ] || die "Usage: scripts/release-package.sh --update <from> <to>"
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

  # template.json is generated after the archive and then appended to the package: every other entry
  # is still git archive's exact bytes (permissions and timestamps untouched), and the "export only
  # tracked files" premise still holds.
  write_template_json "$pkg" "$version" "$ref"
  (cd "$workdir" && zip -q "$out" "$name/template.json")

  selfcheck "$pkg" 1 || true
  check "no excluded paths in the template.json manifest" manifest_leak "$pkg/template.json" "${exclude_paths[@]}"

  upstream="$(grep -rIoE "github\.com/linonward/sass" "$pkg" | wc -l | tr -d ' ')"

  printf '\nPackage: %s (%s, %s files)\nVersion: %s\n' \
    "$out" \
    "$(du -h "$out" | cut -f1)" \
    "$(find "$pkg" -type f | wc -l | tr -d ' ')" \
    "$version"
  printf 'Upstream repo URL appears %s times (used to merge template updates; expected)\n' "$upstream"

  if [ "$fail" -ne 0 ]; then
    printf '\nSelf-check failed. Do not ship this package.\n' >&2
    exit 1
  fi

  printf 'Self-check passed: %s\n' "$out"
  exit 0
fi

# ---- Update package ----
from_ver="$(version_of "$from")"
to_ver="$(version_of "$to")"
name="sass-template-update-$(sanitize "$from_ver")-to-$(sanitize "$to_ver")"
out="$root/dist/$name.zip"
pkg="$workdir/$name"
mkdir -p "$pkg/new" "$pkg/base"

# Change list: same excludes; renames are not tracked (a rename shows up as delete + add, which is
# safer than guessing renames).
changed="$(git diff --name-status --no-renames "$from" "$to" -- . "${excludes[@]}")"
[ -n "$changed" ] || die "No shipped files changed between the two refs; not building an update package ($from_ver → $to_ver)."

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
    *) die "Unknown change type: $st $path" ;;
  esac
  printf '%s\t%s\t%s\n' "$status" "$mode_bits" "$path" >>"$workdir/files.tsv"
done <<<"$changed"

# The new version's template.json: same generation logic as the full package. After applying the
# update the buyer keeps it, and it becomes the starting point of the next update — so it must
# describe the **complete** new version, not just the changed files.
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
check "no excluded paths in the template.json manifest" manifest_leak "$pkg/new/template.json" "${exclude_paths[@]}"

(cd "$workdir" && zip -qr "$out" "$name")

printf '\nUpdate package: %s (%s, %s files)\n%s → %s\n' \
  "$out" \
  "$(du -h "$out" | cut -f1)" \
  "$(find "$pkg" -type f | wc -l | tr -d ' ')" \
  "$from_ver" "$to_ver"
printf 'Changes: %s\n' "$changes"

if [ "$fail" -ne 0 ]; then
  printf '\nSelf-check failed. Do not ship this package.\n' >&2
  exit 1
fi

printf 'Self-check passed: %s\n' "$out"