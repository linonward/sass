# Upgrading to a new template version

Your product is a repository copied from this template, and later template updates (bug fixes, new modules, dependency upgrades) need to be merged into it. There are two ways to do that:

- **Update package** (recommended): when the seller publishes a new version, you get a `sass-template-update-<old version>-to-<new version>.zip` that contains only the changes to **shipped files** between those two versions. The apply script does a three-way merge file by file: files you never touched simply take the new version, files changed on both sides are merged automatically, and anything that can't be merged is left with conflict markers for you to resolve. This path needs no access to the template repository and no shared Git history with it.
- **`git merge`** (optional): add the template repository as `upstream` and merge its `main` directly. This only works for projects that started from GitHub's "Use this template" and share Git history with the template; for the costs and limits, see [Merging with git merge](#merging-with-git-merge-optional).

Both paths rest on the same thing: your app code stays within the directory boundaries.

## Directory boundaries

| Path                                            | Owner    | Notes                                                                                         |
| ----------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `src/core/**`                                   | Template | Avoid changing it in your project; if you do, you resolve the conflicts when merging upstream |
| `src/app/[locale]/(marketing)/**`, `(admin)/**` | Template | Routes for the landing page, pricing, legal pages, blog, and admin                            |
| `src/app/api/**`                                | Template | API routes for sign-in, payments, uploads, and AI                                             |
| `drizzle/`                                      | Both     | Migration files; both sides add them, see "Migration conflicts" below                         |
| `src/app/[locale]/(app)/**`                     | App      | Signed-in product pages (except the dashboard and other pages the template ships)             |
| `src/features/**`                               | App      | Business logic, components, tables (`src/features/*/schema.ts`)                               |
| `site.config.ts`                                | App      | Brand, domain, feature toggles, plans, rate limit thresholds, sidebar menu                    |
| `messages/**`, `content/**`, `public/**`        | App      | Copy, legal page text, blog posts, images                                                     |

When writing app code:

- Put new features in `src/features/<name>/` and the route file in `src/app/[locale]/(app)/<name>/page.tsx`, which only forwards to the page in the feature (see `src/features/example/`).
- Import what you need from `src/core` (`runAI`, `deductCredits`, `getSession`, `buildMetadata`, `@/core/ui/*`, and so on) instead of copying it and editing the copy.
- Sidebar menu items go in `dashboard.nav` in `site.config.ts`; those paths require sign-in automatically.
- When you really do need to change `src/core`, keep the change as small as possible and explain why in the commit message. If it could be a config option or a hook, prefer proposing it to the template repository.

## Upgrading with an update package (recommended)

### What's in an update package

A zip that unpacks to:

| Path                | What it is                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `update.json`       | Machine-readable change list: `from` / `to` versions, and each file's change type (`added` / `modified` / `deleted`) and mode bits   |
| `new/`              | Files from the new version                                                                                                           |
| `base/`             | The changed files as they were in the **previous version** — the base for the three-way merge; you normally don't need to look at it |
| `new/template.json` | The new version's baseline, which the script takes over once the update applies cleanly (see below)                                  |

The package contains none of the template author's internal docs and none of the seller's domains or test credentials: update packages and release packages use the same exclusion list and the same self-checks.

### Version continuity: `template.json`

The release package (and every update package) includes a `template.json`: the version number, the matching commit, the build time, and **the sha256 of every shipped file**. It does two jobs:

- **Checking the starting point**: the apply script compares the `version` in your `template.json` with the update package's `from`; if they don't match, it refuses and tells you to apply the versions in between. So update packages must be **applied in order** (first `v1.0.0 → v1.1.0`, then `v1.1.0 → v1.2.0`).
- **Detecting whether migrations were touched**: by comparing the hashes in the manifest with what's currently under `drizzle/`, the script knows which migrations you added, changed, or deleted.

Version numbers are tags the seller puts on their repository; a version without a tag uses the `package.json` version plus the short commit hash (for example `0.1.0-9806e3b`).

### Steps

```bash
# 0. Commit or back up your current changes first — the script edits the working tree directly and doesn't touch git history
git status

# 1. Apply the update package (a zip or an unpacked directory both work)
scripts/apply-template-update.sh ~/Downloads/sass-template-update-v1.0.0-to-v1.1.0.zip

# 2. Handle conflicts and migrations based on what the script prints (see the next two sections); don't skip this when the script exits non-zero

# 3. Dependencies and verification
pnpm install
pnpm test
pnpm db:migrate      # only needed when this update brings new migrations

# 4. Commit yourself (the script doesn't touch git history; the commit message is up to you)
git add -A && git commit -m "chore: apply template update"
```

> No `scripts/apply-template-update.sh` in your repository yet? It entered the package with a particular update. For your first update, copy `new/scripts/apply-template-update.sh` from the package into your `scripts/` directory, then follow the steps above.

What the script does with each changed file:

| Your file | Template | Result                                                                             |
| --------- | -------- | ---------------------------------------------------------------------------------- |
| Untouched | Changed  | Takes the new version                                                              |
| Changed   | Changed  | Three-way merge; merges automatically if it can, otherwise leaves conflict markers |
| Deleted   | Changed  | Skipped, not restored for you (it's listed in the output)                          |
| Present   | Deleted  | Only reported, not deleted for you                                                 |

When everything is clean, the script updates `template.json` to the new version — the next update picks up from there.

### Conflicts: the markers the script leaves

When both sides changed the same spot, the file ends up with:

```
<<<<<<< yours (current)
your content
=======
content from the new template version
>>>>>>> template (new)
```

The script lists every conflicted file and exits non-zero. The new template version is at `new/<path>` in the update package and the previous template version is at `base/<path>`, so you can compare them directly.

Once you've resolved the conflicts, tell the script which paths you resolved and rerun it with the same update package: files that were already applied are skipped, so rerunning is safe.

```bash
scripts/apply-template-update.sh --resolved site.config.ts --resolved messages/en.json \
  ~/Downloads/sass-template-update-v1.0.0-to-v1.1.0.zip
```

**Unresolved conflicts don't advance the version baseline**: because the baseline stays put, the changes that didn't land this time can still be picked up later. Until the conflicts and migrations are cleared, the next update package is blocked by the version check — this is intentional.

### Migration conflicts

`drizzle/` is the only directory that can't be merged mechanically: migration file names (numbers) are unique across the whole database, and the snapshot chain has to stay closed. So the rule is: **if you've touched migrations since the last version and this template update also changes migrations, the script stops for the whole block**, leaves every file under `drizzle/` untouched, and prints the steps to follow:

1. Keep your own migrations at their original numbers; copy the template migration files into `drizzle/` under their original names.
2. If numbers collide, keep the number of the template migration and regenerate your own:
   ```bash
   pnpm db:generate --name <your original migration name>
   ```
   The generated migration should only contain your own tables.
3. Verify:
   ```bash
   pnpm migrations:check   # numbers contiguous, when strictly increasing, snapshot chain closed
   pnpm db:migrate         # verify on a Neon branch or a local database first
   ```
4. When done, rerun with `--migrations-done` (same update package); only then does the baseline advance:
   ```bash
   scripts/apply-template-update.sh --migrations-done ~/Downloads/sass-template-update-v1.0.0-to-v1.1.0.zip
   ```

Don't delete and recreate migrations that have already run on your production database: first run `pnpm db:migrate` on a Neon branch to check the result (branches are copy-on-write and don't affect the main branch), then decide how to handle it.

## Merging with git merge (optional)

This path only works for projects that **share Git history with the template** — repositories created with GitHub's "Use this template" or forked from the template repository. Projects that started from the zip you receive after purchase don't have that history; use the [update package](#upgrading-with-an-update-package-recommended) instead.

The first time, add the template repository as `upstream`:

```bash
git remote add upstream https://github.com/linonward/sass.git
```

Then for each merge:

```bash
git checkout -b chore/merge-upstream
git fetch upstream
scripts/core-drift.sh            # check the conflict surface first, see below
git merge upstream/main
pnpm install
pnpm db:generate                  # check whether migrations need regenerating, see below
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Submit the merge as one PR and merge it into `main` after CI passes. On deploy, Vercel runs `pnpm db:migrate` first (see `vercel.json`).

The template's README and `.env.example` record new environment variables and external services; after merging, check the environment variables on Vercel against them.

### Why not `git merge --allow-unrelated-histories`

A project that started from the zip shares no history with the template, so a plain `git merge upstream/main` is refused by git (`refusing to merge unrelated histories`), and `--allow-unrelated-histories` is the switch that turns off that safeguard. It gets the merge to run, but it is **not a complete upgrade path**:

- **Every template change uses the empty tree as the common ancestor**, so git can't tell "what the buyer changed" from "what the template changed". The result isn't a merge of who changed what. Instead, every file whose content differs between the two sides **becomes an add/add conflict**, and every file the buyer changed has to be decided by hand, one by one (in our tests even `package.json` conflicted this way). Files the template deleted aren't deleted on the buyer's side (with an empty ancestor there's no way to express "deleted"), and files the buyer deleted but the template still has are added back.
- **The template's entire tree lands in your repository**, including the template author's internal docs and the full history. In our tests, a zip-started repository with only 2 tracked files grew to 718 files after one `git merge --allow-unrelated-histories upstream/main`.

After merging you'd still have to delete the internal docs that came along, and those deleted files come back on the next merge. The update package exists to avoid all of this: it carries only the shipped files that changed between two versions, and uses **the real content of the previous version** as the merge base instead of the empty tree.

### Checking the conflict surface: `scripts/core-drift.sh`

```bash
scripts/core-drift.sh                  # compares against upstream main by default
scripts/core-drift.sh origin main      # use a different remote and branch
CORE_PATHS="src/core src/app/api" scripts/core-drift.sh
```

The output has three parts, all relative to the point where this project and upstream diverged: kit files this project changed (including uncommitted changes), kit files upstream changed, and files changed on both sides. The third part is where merge conflicts are most likely. When the first part is empty, you can merge directly.

## Common conflicts

**`pnpm-lock.yaml`**: don't merge it by hand. Resolve the `package.json` conflict first, then:

```bash
git checkout --theirs pnpm-lock.yaml     # with an update package: delete it instead; the next line regenerates it
pnpm install --no-frozen-lockfile
git add pnpm-lock.yaml
```

**Migration conflicts** (`drizzle/meta/_journal.json`, `drizzle/meta/*_snapshot.json`): both sides added migrations and the numbers collided. Take upstream's version and regenerate this project's migration (with an update package, the script stops by itself and prints the same steps; see [Migration conflicts](#migration-conflicts)):

```bash
git checkout --theirs drizzle/meta/_journal.json drizzle/meta/<conflicting snapshot>.json
git rm drizzle/<this project's conflicting migration>.sql     # for example 0012_projects.sql
pnpm db:generate --name <original name>           # generates a migration with a new number, containing only this project's tables
git add drizzle
```

If this project's migration has already run on the production database, don't delete and recreate it: first run `pnpm db:migrate` on a Neon branch to check the result, then decide how to handle it.

**`src/core/db/schema/auth.ts`**: this file is generated by `pnpm auth:generate`. On conflict, take upstream's version, then run `pnpm auth:generate` and `pnpm db:generate`.

**`site.config.ts`, `messages/en.json`**: usually upstream added new fields or new copy. Keep this project's values and add the keys upstream added. `pnpm test` checks that the messages keys are complete, and `defineConfig()` points out missing config fields.

**Snapshot tests** (`*.snap`): after changing the domain, routes, or posts, run `pnpm test -u` to update the snapshots, and review the diff before committing.

**Default `<Card>` look** (after the template redesign; see §4.5 of `docs/design.md`): without `tone`, it's no longer the old `ring` but `.panel` — a 1px `--border` outline on a flat surface nearly the same color as the canvas. `<Card>`s on your product pages gain an outline as a result (a small change, but it does conflict). `tone` behaves the same as before and is still the marketing-surface sticker.

**`src/core/ui/page-header.tsx`, `empty-state.tsx`** (new in the template; see §4.5 of `docs/design.md`): the page header and empty state for the product surface and admin. If your product pages have their own `text-2xl font-semibold tracking-tight` title block, you can switch to `<PageHeader>` to match the register; nothing breaks if you don't.

**No blurred shadows in the UI** (after the template redesign; see §6 of `docs/design.md`): `shadow-sm/md/lg` should not appear anywhere in `src/`. For new floating layers, use `.sticker` (an object: 1px outline + zero-blur lip) or step the background back one level; don't add a shadow.
