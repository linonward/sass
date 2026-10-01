# Project guide for AI coding assistants

This is for the AI coding assistant writing product code in this project (Claude Code, Cursor, Codex and the like), and for you, the person directing it. It covers the lines in this template that, if crossed, you pay for again at the next upgrade: directory boundaries, how to add a product page, database migrations, testing, and upgrading.

This file ships in the release package and is updated along with the template's update packages, so **don't edit it directly**. Put your own project rules in `AGENTS.md` (see the next section).

## Making your assistant read this guide

Prerequisite: you have followed steps 1–4 of [docs/starter-guide.md](starter-guide.md) to create the baseline commit, install dependencies, write `.env.local`, and run `pnpm db:migrate` (run `git init` before `pnpm install`, or the git hooks won't install).

When a coding assistant opens the repository, it automatically loads `AGENTS.md` (Cursor, Codex, etc.) or `CLAUDE.md` (Claude Code) from the root. It won't go looking in `docs/` on its own. The release package does **not** include either file: they belong to your project, so the template doesn't ship them and update packages never touch them. Create them once in the repository root:

```bash
cat > AGENTS.md <<'EOF'
# AGENTS.md

Before writing code, read docs/agent-guide.md (directory boundaries, steps for adding a page, migrations, testing, upgrading).
EOF
printf '@AGENTS.md\n' > CLAUDE.md
git add AGENTS.md CLAUDE.md && git commit -m "docs: point coding agents to the agent guide"
```

From then on, add your own rules (what the product does, naming conventions, which pages not to touch) to `AGENTS.md`.

**`pnpm dev` appends a block of text to `AGENTS.md`** (so does running e2e: Playwright starts `pnpm dev`). When the Next.js dev server detects that it is running inside an AI coding assistant, it writes a block to the end of `AGENTS.md` that starts with `<!-- BEGIN:nextjs-agent-rules -->` and is titled "This is NOT the Next.js you know" (it reminds the assistant to write code from the docs in `node_modules/next/dist/docs/` rather than from training data). This is Next.js's own behavior (`node_modules/next/dist/server/lib/generate-agent-files.js`), not a corrupted file:

- What you wrote above it is not overwritten; it only maintains the section between those two markers;
- If you delete it, the next `pnpm dev` writes it back, so just commit it along with your changes and your working tree stays clean;
- If neither `AGENTS.md` nor `CLAUDE.md` exists, it creates both (`CLAUDE.md` contains only `@AGENTS.md`); in that case, add the line pointing to this file.
- If you'd rather manage `AGENTS.md` entirely yourself, Next.js lets you turn this off with `agentRules: false` in `next.config.ts` (see `node_modules/next/dist/docs/01-app/02-guides/ai-agents.md`). Leaving it on is recommended: the reminder below is the reason it exists.

That reminder is correct: the Next.js version this project uses differs from many models' training data (for example, the middleware file is `src/proxy.ts`, and route `params` is a Promise). Check `node_modules/next/dist/docs/` before writing Next.js-related code.

## Hard rules

1. **Don't modify `src/core/`.** Import what you need from `@/core/...`. When a capability is missing, look for a config option first (`site.config.ts`); only if there isn't one, change the kit, keep the change small, and explain why in the commit message.
2. **Product code goes in `src/features/<name>/`.** Route files go in `src/app/[locale]/(app)/<name>/page.tsx` and only re-export.
3. **After changing the schema, run `pnpm db:generate` and don't hand-edit the generated SQL.** Run `pnpm migrations:check` before committing.
4. **Copy goes in `messages/`, and the keys in `en.json` and `zh.json` must match one to one** (`pnpm test` checks this).
5. **UI follows `docs/design.md`:** colors derive from the configured color, no blurred shadows (don't write `shadow-sm/md/lg`), components come from `@/core/ui/*`.
6. **Before handing off, run at least `pnpm lint`, `pnpm typecheck`, and `pnpm test`.** If you changed a page, also run the matching e2e (see [Testing](#testing)).
7. **Commit messages use Conventional Commits** (`feat: …` / `fix: …`); a hook checks them on `git commit`.
8. **The kit's code, comments and docs are in English; keep your changes under `src/core/` in English too** so template updates merge cleanly. Your own product code can use any language. `pnpm english:check` (also run in CI) checks `src/core/` for Chinese text.

## Directory boundaries

When the template ships a new version, buyers upgrade with an update package ([UPGRADING.md](../UPGRADING.md)). The update package contains only **the template's own files**, and the apply script does a three-way merge on each one: files you haven't touched are replaced with the new version; files that both you and this template release changed get merged; if the merge fails, conflict markers are left for you to resolve by hand. So the directory boundaries mean something concrete: **every line you change in a template file is a potential conflict at every future upgrade; files you create are never touched by an update package.**

| Path                                              | Owner    | Effect on upgrades                                                                                                                               |
| ------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/core/**`                                     | Template | Where upgrades change the most. Change one line and you merge by hand every time the template touches that file                                  |
| `src/app/[locale]/(marketing)/**`, `(admin)/**`   | Template | Landing page, pricing, legal pages, blog, admin; same as above                                                                                   |
| `src/app/api/**`                                  | Template | Sign-in, payments, uploads, AI, and webhook endpoints; same as above                                                                             |
| `drizzle/`                                        | Both     | Both sides add migrations and the numbers can collide; the upgrade script stops here for you to handle it (see [Database](#database))            |
| `src/features/<your module>/`                     | Product  | Directories you create; upgrades never touch them                                                                                                |
| `src/app/[locale]/(app)/<your page>/`             | Product  | Same as above; the template's own `dashboard`, `billing`, `settings`, etc. pages still belong to the template                                    |
| `site.config.ts`, `messages/*.json`               | Product  | The template also adds new fields / new copy here. Changing values and adding your own keys is fine; don't delete or reorder the template's keys |
| `content/**`, `public/**`                         | Product  | Legal page text, blog, images; change freely                                                                                                     |
| `src/features/example/`, `src/features/invoices/` | Template | Example modules. Either keep them as they are or delete them entirely (see the checklist in each one's files); don't turn them into your product |

The last row deserves a word: if you want to start from an example, **copy** it to a new name (`src/features/projects/`) and change the copy, rather than editing the example in place. If you edit it in place, you'll get a pile of conflicts unrelated to your product whenever the template fixes the example; deleted files are skipped by the upgrade script and won't be put back.

## Adding a product page

Take a "Projects" page as the example: visible after sign-in, listed in the sidebar, with the module name `projects`. The whole process **doesn't change any file in `src/core/`**.

### 1. Feature module

`src/features/projects/page.tsx` is the page itself. All kit capabilities are imported from `@/core`.

```tsx
import { getTranslations } from "next-intl/server";

import { requirePageSession } from "@/core/auth/session";
import { buildMetadata } from "@/core/seo/metadata";
import { EmptyState } from "@/core/ui/empty-state";
import { PageHeader } from "@/core/ui/page-header";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Projects" });
  return buildMetadata({
    locale,
    path: "/projects",
    title: t("title"),
    noIndex: true,
  });
}

export default async function ProjectsPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Projects" });
  // The (app) layout already blocks signed-out visits; we get the session here for the current user.
  const { user } = await requirePageSession(locale);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("description", { email: user.email })}
      />
      <EmptyState
        titleAs="h2"
        title={t("emptyTitle")}
        description={t("emptyDescription")}
      />
    </div>
  );
}
```

Put pure logic (calculation, validation, formatting) in plain modules in the same directory (such as `src/features/projects/projects.ts`) so it's easy to unit test. For fuller examples, see `src/features/example/` (calls AI, spends credits) and `src/features/invoices/` (CRUD with a table, a list, and Server Actions).

### 2. Route files

`src/app/[locale]/(app)/projects/page.tsx` is a single re-export:

```tsx
export { default, generateMetadata } from "@/features/projects/page";
```

Pages under `(app)` require sign-in automatically (signed-out visitors are sent to `/sign-in`).

### 3. Sidebar menu

Add an item to `dashboard.nav` in `site.config.ts`:

```ts
dashboard: {
  nav: [
    // …keep the existing items
    { key: "projects", href: "/projects", icon: "layers" },
  ],
},
```

- `key` maps to the copy at `Dashboard.nav.<key>`; `href` must be an on-site path;
- `icon` must come from `dashboardIcons` in `src/core/config/schema.ts` (`home`, `settings`, `layers`, `sparkles`, `fileText`, `chart`, `users`, `creditCard`, `key`, `flag`, `receipt`, `download`); anything else fails config validation at startup;
- These items appear in the sidebar's **Product** group (copy `Dashboard.businessNav`); the kit's own items such as Dashboard / Billing / Settings are in the other group;
- For paths listed here, signed-out visitors are sent to sign-in with a return URL (`/sign-in?callbackURL=%2Fprojects`).

### 4. Copy

Change **both** `messages/en.json` and `messages/zh.json`, **with identical keys**. Below is the structure for illustration (the comments are only explanatory; real JSON can't contain comments):

```jsonc
// messages/en.json
{
  "Dashboard": {
    "nav": {
      // …keep the existing keys
      "projects": "Projects",
    },
  },
  // Add a new top-level namespace whose name matches the namespace passed to getTranslations
  "Projects": {
    "title": "Projects",
    "description": "Everything you're working on, {email}.",
    "emptyTitle": "No projects yet",
    "emptyDescription": "Projects you create will show up here.",
  },
}
```

`zh.json` has the same structure, filled in with Chinese. To add a language, see [docs/i18n.md](i18n.md).

Verify:

```bash
pnpm test src/core/i18n/messages.test.ts   # en/zh keys match, every sidebar key has copy
pnpm typecheck                              # route types and site.config fields
pnpm dev                                    # after sign-in, Projects appears in the sidebar and opens
```

### 5. Unit tests

Unit tests sit next to the file under test and are named `*.test.ts` / `*.test.tsx` (`vitest.config.mts` only picks up these two patterns under `src/**`). For example, a pure function in the feature:

```ts
// src/features/projects/projects.ts
export function slugify(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}
```

```ts
// src/features/projects/projects.test.ts
import { describe, expect, test } from "vitest";

import { slugify } from "./projects";

describe("slugify", () => {
  test("lowercases and replaces whitespace with hyphens", () => {
    expect(slugify("My First Project")).toBe("my-first-project");
  });
});
```

```bash
pnpm test src/features/projects   # run only this module
pnpm test                         # run everything
```

For component tests, see `src/features/example/tagline-tool.test.tsx`.

### 6. e2e

`e2e/projects.spec.ts`. Sign in with the ready-made functions in `e2e/auth-helpers.ts`, and read copy straight from `messages/en.json` (changing copy doesn't require changing the test):

```ts
import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import { signIn, uniqueEmail, useRandomIp } from "./auth-helpers";

test.beforeEach(async ({ page }) => {
  await useRandomIp(page); // a new IP per test so you don't hit the sign-in rate limit
});

test("signed-out visit goes to sign-in, then back to Projects after sign-in", async ({
  page,
}) => {
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/sign-in\?callbackURL=%2Fprojects/);
  await signIn(page, uniqueEmail("projects"));
  await expect(page).toHaveURL("/projects");
  await expect(
    page.getByRole("heading", { name: messages.Projects.title, level: 1 }),
  ).toBeVisible();
});
```

How to run it is in the next section.

## Database

Product tables go in `src/features/<name>/schema.ts` (`drizzle.config.ts` picks up this path automatically; there's nothing to register in `src/core`). Copy the pattern in `src/features/invoices/schema.ts`: a primary key, a `user_id` foreign key with `onDelete: "cascade"`, money stored as an integer in the smallest currency unit, and every read and write filtered by `user_id`.

The order is fixed:

```bash
# 1. Change src/features/<name>/schema.ts
pnpm db:generate --name <name>   # 2. Generate the migration: drizzle/<number>_<name>.sql + a snapshot under drizzle/meta/
pnpm migrations:check            # 3. Offline check: sequential numbers, strictly increasing when, closed snapshot chain
pnpm db:migrate                  # 4. Apply to the database DATABASE_URL points to (local first, then production)
```

- **Don't hand-edit** the generated SQL or `drizzle/meta/`. To change something, change the schema and generate a new migration.
- Don't delete and recreate migrations that have already run on the production database.
- Database unit tests read `DATABASE_URL_TEST`: when it's unset the whole group is skipped and the exit code is still 0. In `.env.example` this line is enabled by default and points to **the same database** as `DATABASE_URL`. If you copy it into `.env.local` as is, test data gets written to your development database; to keep them separate, create a dedicated database (for example `.../postgres_test`) and change this line.
- **Migration number collisions during upgrades** (you added `0024_projects`, and the new template version also brings a `0024_…`): the upgrade script stops on the whole `drizzle/` directory without touching a single file, and prints the steps to follow. Keep the template's number, then regenerate your own migration with `pnpm db:generate --name <your original name>`. The full steps are in [the "Migration conflicts" section of UPGRADING.md](../UPGRADING.md#migration-conflicts).

## Testing

| Command                                  | When to run it                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm lint`                              | Before every commit (the hook only checks staged files)                                |
| `pnpm typecheck`                         | After changing routes, `site.config.ts`, or types                                      |
| `pnpm test`                              | Before every commit                                                                    |
| `pnpm migrations:check`                  | After touching `drizzle/`                                                              |
| `pnpm english:check`                     | After touching `src/core/` (kit code stays English)                                    |
| `npx playwright test e2e/<name>.spec.ts` | After changing a page (full command below)                                             |
| `pnpm build`                             | Before launch; unchanged placeholder values and missing copy keys are both caught here |

### Running e2e

The first time, install the browser:

```bash
pnpm exec playwright install chromium
```

Prerequisites: local Postgres is running, you've run `pnpm db:migrate`, and `.env.local` has `DATABASE_URL` (Playwright reads `.env.local` automatically, so you don't need it on the command line).

**Run only your own tests** (the minimal working command):

```bash
EMAIL_TRANSPORT=file E2E_PORT=3100 npx playwright test e2e/projects.spec.ts --project=desktop
```

- `EMAIL_TRANSPORT=file` is required: the sign-in code has to be written to `.tmp/emails/`, which is where `signIn()` reads it. The local default is `console`, which only prints the code to the terminal, so the test gets stuck at the code-entry step.
- Set `E2E_PORT` to a port other than 3000: if you have `pnpm dev` running, Playwright reuses that server, and it may not be testing your current code.
- Drop `--project=desktop` to also run at phone size (`mobile`).
- It's normal for `AGENTS.md` to gain a block of English text after a run; see [Making your assistant read this guide](#making-your-assistant-read-this-guide).
- Each run also starts a multi-locale copy of the site (`e2e/i18n/serve.ts`: copies the repository to a temp directory, installs dependencies, starts it), so the first run takes an extra minute or two. It lists files with `git ls-files`, so the repository must be `git init`-ed first.

**Run the full suite** (when you changed something shared, or want a complete run before committing). The template's own tests depend on this whole set of variables; **copy the whole set as is**:

```bash
EMAIL_TRANSPORT=file E2E_PORT=3100 \
  ADMIN_EMAILS=e2e-admin-desktop@example.com,e2e-admin-mobile@example.com,e2e-admin-acquisition-desktop@example.com,e2e-admin-acquisition-mobile@example.com,e2e-admin-status-desktop@example.com,e2e-admin-status-mobile@example.com,e2e-admin-flags-desktop@example.com,e2e-admin-flags-mobile@example.com \
  BILLING_PROVIDER=fake BILLING_SUCCESS_TIMEOUT_MS=8000 \
  WAFFO_PRODUCT_ID_PRO=prod_ci_fake_pro WAFFO_PRODUCT_ID_LIFETIME=prod_ci_fake_lifetime \
  SITE_NAME="CI Site" SITE_DOMAIN=ci.example.test \
  SITE_LEGAL_NAME="CI Legal Entity" SITE_EMAIL_FROM=noreply@ci.example.test \
  SITE_CONTACT_EMAIL=support@ci.example.test \
  npx playwright test
```

These values are the same set as the `env:` at the top of `.github/workflows/ci.yml`. Leaving one out doesn't necessarily cause an error; more often a whole block of tests is **silently skipped** (for example, without `BILLING_PROVIDER=fake` the checkout flow doesn't run and the summary is still all green). Setting only half of them makes assertions contradict each other and fail. The three additional `ALLOW_*` variables in `ci.yml` are only needed when running against a production build (`pnpm build` followed by `CI=1 npx playwright test`).

Three more suites have their own configs: `pnpm test:e2e:acquisition`, `pnpm test:e2e:flags`, and `pnpm test:e2e:invoices`. They take the same set of variables.

**Every page fails with `SyntaxError: Unexpected non-whitespace character after JSON`**: the cache in `.next/dev/` was corrupted by an interrupted dev server. It's not a code problem; `rm -rf .next` and start again.

## Upgrading

When the seller releases a new version, you get a `sass-template-update-<old version>-to-<new version>.zip`. Steps:

```bash
git status                                            # 0. The working tree must be clean: commit what you have first
scripts/apply-template-update.sh ~/Downloads/sass-template-update-<old>-to-<new>.zip
# 1. A non-zero exit = conflicts or migrations to handle; work through the list it prints, don't skip any
pnpm install && pnpm test                             # 2. Dependencies and verification (add pnpm db:generate if tables changed)
git add -A && git commit -m "chore: upgrade template to <new version>"   # 3. You commit it yourself
```

- `template.json` in the root records which version you have. **Don't edit it by hand.** When it's wrong, the script refuses to apply and tells you to apply the intermediate versions first.
- When an assistant helps you upgrade: **don't resolve semantic conflicts on the user's behalf and then commit.** List the conflicted files for a human to review. After resolving, rerun with `--resolved <path>` so the baseline advances.
- Conflict markers, how to use `--resolved` and `--migrations-done`, and common conflicts (`pnpm-lock.yaml`, `site.config.ts`, `messages/en.json`) are all covered in [UPGRADING.md](../UPGRADING.md).

## Other docs

| What you want to do                                      | Where to look                             |
| -------------------------------------------------------- | ----------------------------------------- |
| Go from zero to launch, make it your own site            | [docs/starter-guide.md](starter-guide.md) |
| All config options, the launch checklist, module toggles | [README.md](../README.md)                 |
| UI: colors, surfaces, how to use components              | [docs/design.md](design.md)               |
| Add a language                                           | [docs/i18n.md](i18n.md)                   |
| Payment providers                                        | [docs/billing.md](billing.md)             |
| Upgrading, resolving conflicts                           | [UPGRADING.md](../UPGRADING.md)           |
