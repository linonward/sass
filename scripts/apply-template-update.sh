#!/usr/bin/env bash
# Buyer side: applies a template update package to your own repo.
#
# Usage:
#   scripts/apply-template-update.sh <update-package.zip or unpacked directory>
#   scripts/apply-template-update.sh --resolved <path> [--resolved <path>…] <update package>
#   scripts/apply-template-update.sh --migrations-done <update package>
#
# Per-file three-way merge: base = the old copy in the update package, ours = your current file,
# theirs = the new version.
#
#   · template changed it, you didn't      → take the new version
#   · both changed it, merges cleanly      → merge automatically
#   · both changed it, doesn't merge       → leave conflict markers in the file, list it, exit non-zero
#   · files the template deleted           → only reported, not deleted for you
#   · files you deleted                    → skipped, not restored for you
#
# The script **does not touch git history**: merge results stay in the working tree; review them and
# commit yourself.
#
# While conflicts or migrations are unresolved, the version baseline (template.json) is **not**
# advanced — the next update picks up from it, and advancing it early would mean the changes that
# didn't land this time could never be recovered. Once you've dealt with them, tell the script "I've
# handled this" with the two flags below and rerun; only then is the baseline advanced (files that
# were already applied are skipped, so rerunning is safe):
#
#   --resolved <path>    I resolved this file by hand; keep mine and leave it alone (repeatable)
#   --migrations-done    migrations were handled per the steps the script printed (only takes
#                        effect when migrations were actually held back)
#
# Requires git (`git merge-file` does the three-way merge) and node (reads the manifest).
set -euo pipefail

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  scripts/apply-template-update.sh <update-package.zip or unpacked directory>
  scripts/apply-template-update.sh --resolved <path> [--resolved <path>…] <update package>
  scripts/apply-template-update.sh --migrations-done <update package>

  --resolved <path>   you resolved this file's conflicts by hand; keep yours, leave it alone (repeatable)
  --migrations-done   migrations were handled per the steps the script printed (only meaningful
                      when migrations were actually held back)
EOF
}

update=""
resolved=()
migrations_done=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --resolved)
      [ -n "${2:-}" ] || die "--resolved must be followed by a path."
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
      die "Unknown option: $1 (see --help for usage)"
      ;;
    *)
      [ -z "$update" ] || die "Only one update package is accepted, got two: $update and $1"
      update="$1"
      shift
      ;;
  esac
done
[ -n "$update" ] || die "No update package given. See --help for usage."

is_resolved() {
  local p="$1" r
  for r in ${resolved[@]+"${resolved[@]}"}; do
    [ "$p" = "$r" ] && return 0
  done
  return 1
}

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

command -v git >/dev/null 2>&1 || die "git is required: the three-way merge uses git merge-file."
command -v node >/dev/null 2>&1 || die "node is required: it reads the update package manifest."
[ -f template.json ] ||
  die "No template.json in the current directory — the update package relies on it to confirm the starting version; the release package ships with this file."

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
results="$workdir/results"
mkdir -p "$results"

# Either a zip or an already unpacked directory works
if [ -d "$update" ]; then
  src="$(cd "$update" && pwd)"
else
  [ -f "$update" ] || die "Not found: $update"
  unzip -q "$update" -d "$workdir/unpacked"
  src="$(find "$workdir/unpacked" -mindepth 1 -maxdepth 1 -type d | head -1)"
  [ -n "$src" ] || die "$update contains no directory; it doesn't look like an update package."
fi
[ -f "$src/update.json" ] || die "$update has no update.json — this is not an update package this script recognizes."

# Manifest: the first line is from / to, each following line is status / mode / path
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
printf 'Current version: %s\nUpdate package: %s → %s\n\n' "$buyer_ver" "$from_ver" "$to_ver"

if [ "$buyer_ver" != "$from_ver" ]; then
  die "Version mismatch: you have $buyer_ver, but this update package starts from $from_ver.
Update packages must be applied in order — apply the previous version's update package first, then this one."
fi

printf 'Note: the script edits files in the working tree directly and does not touch git history. Commit or back up your current changes first so you can compare and roll back.\n'

# Which migrations have you touched since the last version? Compare against the template.json
# manifest (the previous version's hashes).
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
      out.push(rel + " (you deleted it)");
      continue;
    }
    const h = crypto.createHash("sha256").update(fs.readFileSync(rel)).digest("hex");
    if (h !== hash) out.push(rel + " (you changed it)");
    now.delete(rel);
  }
  for (const extra of now) out.push(extra + " (you added it)");
  process.stdout.write(out.join("\n"));
' >"$results/migrations-touched"

# Both sides touched migrations: hand the whole block to a human, never overwrite silently (the
# template adds migrations, and so does the buyer).
migration_manual=0
if [ -s "$results/migrations-touched" ] && [ -s "$results/drizzle-in-update" ]; then
  migration_manual=1
fi

# Two files have identical content (both missing also counts as identical)
same() {
  if [ ! -e "$1" ] && [ ! -e "$2" ]; then return 0; fi
  [ -f "$1" ] && [ -f "$2" ] && cmp -s "$1" "$2"
}

set_mode() {
  if [ "$2" = "100755" ]; then chmod +x "$1"; fi
}

# Three-way merge. 0 = clean, 1–127 = number of conflicts, anything else (an exit code we can't
# interpret) = can't merge (most likely binary).
merge_three() { # <base> <ours> <theirs>
  local base="$1" ours="$2" theirs="$3" out status=0
  out="$(mktemp)"
  git merge-file -p -L "yours (current)" -L "template (previous)" -L "template (new)" \
    "$ours" "$base" "$theirs" >"$out" 2>/dev/null || status=$?
  if [ "$status" -eq 0 ]; then
    cat "$out" >"$ours"
    printf '%s\n' "$ours" >>"$results/merged"
  elif [ "$status" -le 127 ]; then
    # Write it back to the working tree with conflict markers for a human to review
    cat "$out" >"$ours"
    printf '%s\n' "$ours" >>"$results/conflicted"
  else
    # Can't merge: leave your file untouched, save the new version alongside it, a human decides
    cp "$theirs" "$ours.template-new"
    printf '%s\n' "$ours" >>"$results/unmergeable"
  fi
  rm -f "$out"
}

while IFS=$'\t' read -r status mode_bits path; do
  [ -n "$path" ] || continue

  # Paths the buyer marked as "handled" are never touched — running the three-way merge again on a
  # hand-resolved file would just write the markers back, and the baseline could never advance.
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
        # Both sides added the same file independently: no common ancestor, so the whole file is a conflict
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
      die "Unknown change type: $status $path"
      ;;
  esac
done <"$workdir/changes.tsv"

report() { # <title> <result file name>
  local title="$1" file="$results/$2"
  [ -s "$file" ] || return 0
  printf '%s (%s)\n' "$title" "$(wc -l <"$file" | tr -d ' ')"
  sed 's/^/  · /' "$file"
  printf '\n'
}

printf '\n'
report "Took the new version" applied
report "Merged automatically" merged
report "Conflicts: conflict markers left in place, resolve by hand" conflicted
report "Could not merge (most likely binary): your file is untouched, new version saved as *.template-new" unmergeable
report "The template deleted these files; not deleted for you" deleted-by-template
report "Migration-related, not handled this run" held
report "Template files you deleted, skipped and not restored" removed-by-you
report "Already up to date, skipped" uptodate
report "Kept as is, as you asked (--resolved / --migrations-done)" kept

if [ -s "$results/conflicted" ] || [ -s "$results/unmergeable" ]; then
  printf 'Search conflicted files for `<<<<<<<` to see both sides; the new template version is at new/<path> in the update package, the previous template version at base/<path>.\n'
  printf 'Once resolved, tell the script which paths you resolved and rerun it (same update package):\n\n'
  printf '  scripts/apply-template-update.sh --resolved <path> [--resolved <path>…] %s\n\n' "$update"
fi

if [ -s "$results/held" ]; then
  printf 'Migrations need manual handling; nothing under drizzle/ was touched this run.\n\n'
  printf 'Migrations you touched:\n'
  sed 's/^/  · /' "$results/migrations-touched"
  printf '\nThe migrations this template update brings are under new/drizzle/ in the update package. Steps (details in UPGRADING.md):\n\n'
  printf '  1. Keep your own migrations at their original numbers; copy the template migration files into drizzle/ under their original names.\n'
  printf '  2. If numbers collide, keep the number of the template migration and regenerate your own:\n'
  printf '       pnpm db:generate --name <your original migration name>\n'
  printf '     The generated migration should only contain your own tables.\n'
  printf '  3. pnpm migrations:check   # numbers contiguous, when strictly increasing\n'
  printf '     pnpm db:migrate         # verify on a Neon branch or a local database first\n'
  printf '  4. When done, rerun with --migrations-done (same update package):\n\n'
  printf '       scripts/apply-template-update.sh --migrations-done %s\n\n' "$update"
fi

if [ -s "$results/conflicted" ] || [ -s "$results/unmergeable" ] || [ -s "$results/held" ]; then
  printf 'The version baseline is still %s (not advanced): it lets the changes that did not land this time be picked up later.\n' "$buyer_ver"
  printf 'Only after you clear the items above and rerun as instructed will the baseline advance to %s.\n' "$to_ver"
  exit 1
fi

# All clean: advance the version baseline to the new version; the next update picks up from here.
cp "$src/new/template.json" template.json

printf 'Update complete: %s → %s\n\n' "$from_ver" "$to_ver"
cat <<'EOF'
Next steps:

  pnpm install     # dependencies may have changed (package.json / pnpm-lock.yaml)
  git diff         # review what this update changed
  pnpm test        # unit tests; database tests are skipped without DATABASE_URL_TEST
  pnpm db:migrate  # only needed for new migrations; run on a Neon branch or local database first

Once it looks good, commit yourself (the script does not touch git history):
  git add -A && git commit -m "chore: apply template update"
EOF