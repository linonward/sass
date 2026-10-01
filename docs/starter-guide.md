# Template guide

For people who just got the template: how to go from zero to launch, and for each step, what to type, which button to click, and what you'll see.

This is a **text-only** guide (no screenshots or videos): steps in external dashboards spell out where the button is and what happens, and every local step is a command you can copy as is. Details that need more room link to the matching section of `README.md` instead of being repeated here — each thing is explained in one place only, so the two can't drift apart when one is edited.

This file ships in the buyer release package (it's in the package built by `scripts/release-package.sh`).

## From zero to live in 10 minutes

Goal: on a **clean machine**, go from nothing to "signed in to your own dashboard" in 10 minutes. Those 10 minutes get you to "running locally"; for deploying online, see the [full walkthrough](#deploy-to-vercel) below, where most of the time goes into signing up for external accounts.

Prerequisites (install anything that's missing first):

| You need | Version                                     | How to install                                                          |
| -------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| Node     | 24 (the version in `.nvmrc`)                | nodejs.org, or fnm / nvm using `.nvmrc`                                 |
| pnpm     | 12 (see `packageManager` in `package.json`) | `corepack enable pnpm`                                                  |
| Docker   | A recent version                            | Only used to run a local Postgres; skip it if you already have Postgres |

10 minutes assumes you copy the commands and never get stuck; if you read as you go the first time, you should still finish within 30 minutes. If you get stuck, stop at that step — every step says how to verify it.

- [ ] **1. Create the repository and clone it (about 3 minutes)**

  On the template repository page, click **Use this template** (top right, left of the `Code` button) → **Create a new repository**, choose the Owner, enter a repository name, set visibility to **Private**, and click **Create repository**. After a few seconds you land on your new repository's home page, and where `Use this template` used to be there's now `Code`. For the button order and what each path gives you, see [Create the repository and clone it](#create-the-repository-and-clone-it) below.

  ```bash
  git clone https://github.com/<your-account>/<repo-name>.git && cd <repo-name>
  git remote add upstream https://github.com/linonward/sass.git   # used later to merge template updates, see UPGRADING.md
  ```

  Buyers who received the zip skip this step and instead create a repository in their own directory and commit a baseline once (the zip contains none of the template author's internal docs, and there's no `upstream` to add):

  ```bash
  git init && git add -A && git commit -m "chore: import template"
  ```

  When the template releases a new version, the seller gives you an update package that you apply with `scripts/apply-template-update.sh` — see [UPGRADING.md](../UPGRADING.md) for the steps.

  **The GitHub path needs one more thing: delete the template author's internal docs** (`AGENTS.md`, `CLAUDE.md`, `docs/plan.md`, `docs/workflow.md`, `docs/tasks/`, `docs/go-to-market.md`, `docs/competitive-landscape.md`). The commands and the reason for each are in the README's [step 1: Create a repository from the template](../README.md#1-create-a-repository-from-the-template). **Don't skip it**: tools like Claude Code load `AGENTS.md` automatically, and the template author's workflow would be followed as your project's rules.

  Verify: on the zip path, `git log --oneline` shows that one baseline commit; on the GitHub path, `git remote -v` shows the `upstream` line, and `ls docs/tasks` reports `No such file or directory`.

- [ ] **2. Install dependencies and write `.env.local` (about 2 minutes)**

  ```bash
  pnpm install
  cp .env.example .env.local
  openssl rand -base64 32          # copy the output; it goes into BETTER_AUTH_SECRET below
  ```

  Then edit `.env.local`. Locally, only two values are required:

  - `DATABASE_URL`: the default `postgres://postgres:postgres@localhost:5432/postgres` is the Docker database from the next step, so use it as is;
  - `BETTER_AUTH_SECRET`: the `openssl` output from above (**anything shorter than 32 characters fails at startup**).

  Leave the other variables alone — locally you don't need any external accounts, and modules without a key either skip themselves or return 503 (see [Get it running locally](#get-it-running-locally)).

  Verify: `pnpm install` finishes without errors (it also installs the git hooks); `ls .env.local` shows the file.

- [ ] **3. Start a local Postgres (about 1 minute)**

  ```bash
  docker run -d --name sass-postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:18
  ```

  If you already have Postgres on your machine, skip this line and put its address in `DATABASE_URL` in `.env.local`.

  Building a second product on the same machine? The name `sass-postgres` and port `5432` are already taken by the first one, so give this one its own, for example `--name shop-postgres -p 5433:5432`, and change the port in `DATABASE_URL` and `DATABASE_URL_TEST` in `.env.local` to `5433` to match.

  Verify: in `docker ps`, the status of `sass-postgres` is `Up` (right after starting it shows `health: starting`, which changes after a few seconds).

- [ ] **4. Create the tables: `pnpm db:migrate` (about 1 minute)**

  ```bash
  pnpm db:migrate
  ```

  You'll see `[✓] migrations applied successfully!`. **Do this before `pnpm dev`**: until the database has tables, the sign-in and admin pages error out with missing tables. Running it again is safe (migrations that already ran are skipped); rerun it whenever you switch databases, switch machines, or pull new migrations.

  Verify: the output contains `migrations applied successfully`. To see what the tables look like: `pnpm db:studio`.

- [ ] **5. Start the dev server: `pnpm dev` (about 1 minute)**

  ```bash
  pnpm dev
  ```

  You'll see `▲ Next.js …`, `- Local: http://localhost:3000`, `- Environments: .env.local`, `✓ Ready`. Open `http://localhost:3000` for the landing page; its title is the `name` in `site.config.ts` (`Acme` out of the box).

  The same terminal also shows a block of placeholder warnings listing 4 fields — **dev only warns, but a production build fails outright**; see [Most common pitfalls](#most-common-pitfalls). Missing required variables work the other way: startup fails with `Invalid environment variables:` and lists the variable names one by one.

- [ ] **6. Sign in and go through the onboarding checklist (about 2 minutes)**

  Open `http://localhost:3000/sign-in`, enter any email (`me@example.com` is fine; it doesn't need to exist), and click **Send code**. **The code isn't sent to an inbox; it's printed in the terminal running `pnpm dev`**, like this:

  ```
  ──────── email (EMAIL_TRANSPORT=console) ────────
  To:       me@example.com
  Subject:  Your Acme sign-in code
  ...
  420041
  ```

  Enter the 6 digits in **Verification code** and click **Sign in**. **Your first sign-in lands on `/onboarding` first**: a Getting started checklist page (five steps with the default config). Each step is judged from the config in your repository — the brand color, site name, and pricing steps list the default values you haven't changed yet, while publishing a post and deploying have no reliable signal, so you check those yourself. Click **Mark as done** to go to `/dashboard`; when the header shows `Signed in as <your email>`, you're running locally. Later sign-ins skip the checklist page; to get back to it, use the **Product** group in the sidebar.

  The dashboard shows an empty state (the sidebar has two groups: **Main** with Dashboard / Playground / Invoices / Billing / Settings, and **Product** with Getting started and the Taglines example). **Empty is normal** — the dashboard the template ships with is empty by design.

  To see what it looks like with data: the README's [See what it looks like with data](../README.md#see-what-it-looks-like-with-data) (one command loads demo data).

At this point you have a local site you can sign in to and configure. Next come "make it your own" and "deploy": [Full walkthrough](#full-walkthrough-from-repository-to-launch).

## Full walkthrough: from repository to launch

This covers the four stages in order. The local commands are all in the checklist above and aren't repeated here; for each step in an external dashboard, it says where to click and what you'll see.

### Create the repository and clone it

There are two delivery paths, and they end up in the same place:

| Path                               | What you get                                                                                     | What else to do                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| GitHub "Use this template"         | A repository of your own, including the template author's internal docs (`AGENTS.md` and others) | Clone it locally, add `upstream`, delete the internal docs; upgrade with `git merge`                         |
| The zip you receive after purchase | A directory with the internal docs already removed, plus a `template.json`                       | Unzip, `git init`, and commit a baseline; upgrade with update packages (see [UPGRADING.md](../UPGRADING.md)) |

The button order for the GitHub path:

1. Open the template repository and click **Use this template** → **Create a new repository** (in the dropdown to the left of the `Code` button).
2. In the form, choose the **Owner**, fill in the **Repository name**, set visibility to **Private** (the template is sold per copy under a proprietary license, so don't make the repository public), and click **Create repository**.
3. After a few seconds you land on the new repository's home page: where `Use this template` used to be there's now `Code`, and this page is your repository.
4. Click **Code** → **HTTPS** to copy the URL, then `git clone` it locally (the command is in [step 1 of the checklist](#from-zero-to-live-in-10-minutes)).
5. Add `upstream` and delete the internal docs — the commands and the reason for each are in the README's [step 1](../README.md#1-create-a-repository-from-the-template). If `AGENTS.md` / `CLAUDE.md` reappear after you delete them, the end of that section explains why (`next dev` writes them; it's not that you didn't delete them properly).

### Get it running locally

Once you've finished [steps 2–6 of the checklist](#from-zero-to-live-in-10-minutes), you're in this state. A few things worth knowing:

- **You don't need any external accounts locally.** Emails are printed in the terminal (when `EMAIL_TRANSPORT` is unset it defaults to `console` locally, and that's where you read sign-in codes); payments, rate limiting, uploads, and AI each return 503 or quietly skip when they have no key. The database is the Docker one you started yourself. So until you go through the launch process, you don't need to sign up for a single third-party service.
- **An empty dashboard is normal**; the template has no business data. To see how it looks, load a batch of demo data (see the link in step 6 of the checklist).
- Other common local commands (`pnpm test`, `pnpm lint`, `pnpm email:dev`, `pnpm db:studio`, and so on) are in the table in the README's [Local development](../README.md#local-development).

### Make it your own site

This is the only stage before launch where you must change code. At a minimum, change these:

1. **The 6 placeholder values in `site.config.ts`**: `name`, `domain`, `legal.companyName`, `email.fromAddress`, `legal.contactEmail`, `email.replyTo`. If you don't change them, the production build fails outright (see item 1 of the next section).
2. **The rest of the site config**: brand color, feature toggles, legal info, pricing plans, sender, AI models. The full list of fields and what each does is in the README's [Make it your own site](../README.md#3-make-it-your-own-site).
3. **Copy and content**: `messages/en.json` (page copy), `content/legal/` (legal page text), `content/blog/` (posts), `public/` (your own logo and hero image).
4. **The example module**: `src/features/example/` (a Taglines generator that deducts credits) shows how app code calls `runAI` and `deductCredits`, and how to add menu items to `dashboard.nav`; once you've read it, delete it using the checklist in [the same section](../README.md#3-make-it-your-own-site).

When you're done, run `pnpm test` and `pnpm build` to make sure you didn't miss anything — `build` checks for problems like placeholder values and missing `messages` keys for you.

### Deploy to Vercel

Vercel's interface gets redesigned now and then; if you can't find a button, look for it by name — the flow stays the same.

1. Open vercel.com, sign in with your GitHub account, and click **Add New…** → **Project**.
2. In the **Import Git Repository** list, find the repository you just created and click **Import**. If it's not in the list, click **Adjust GitHub App Permissions** below the list and give Vercel access to the repository (details in [section 1 of the README's launch checklist](../README.md#1-vercel)).
3. You'll see the New Project form: **Framework Preset** is automatically `Next.js`, and **Build Command** is `pnpm db:migrate && pnpm build` (from `vercel.json` at the repository root). Leave both as they are.
4. **Don't click Deploy yet**: expand **Environment Variables** and fill in the required variables using the table in [section 3 of the README's launch checklist](../README.md#3-environment-variables) (at least `DATABASE_URL`, `RESEND_API_KEY`, `BETTER_AUTH_SECRET`). Set up the external accounts this step needs (Neon, Resend, Google, Waffo Pancake…) according to [the modules you enabled](../README.md#4-external-accounts-for-the-modules-you-enabled); you don't need all of them at once, only the ones for modules you turned on.
5. Click **Deploy**. The build log runs `pnpm db:migrate` first and then `next build`; **if the placeholder values weren't changed or a required variable is missing, the build fails outright and names which one** — the template does this on purpose; fix it and redeploy. If the migration fails, the previous version stays live.
6. After a successful build, Vercel gives you a `*.vercel.app` URL; open it and make sure the home page loads. To connect your own domain (what to put in DNS), see [section 2 of the README's launch checklist](../README.md#2-domain-and-dns).
7. For the post-launch self-check (both sign-in methods, one purchase with a test card, the order showing up in admin), see the README's [step 6](../README.md#6-go-through-the-launch-checklist-and-turn-on-real-payments).

## Most common pitfalls

1. **If you don't change the 6 placeholder values, the production build fails outright.** While `name`, `domain`, `legal.companyName`, `email.fromAddress`, `legal.contactEmail`, and `email.replyTo` in `site.config.ts` still have their default values, `pnpm dev` only prints a warning line, but `pnpm build` (and the build on Vercel) throws and lists each field name with how to fix it. This check lives in `src/core/config/sentinels.ts`: it only warns in development and blocks in production, so a site doesn't go live still showing Acme and example.com. To override with environment variables (one codebase, several environments): `SITE_NAME` / `SITE_DOMAIN` / `SITE_LEGAL_NAME` / `SITE_EMAIL_FROM` / `SITE_CONTACT_EMAIL` (the last one sets both `legal.contactEmail` and `email.replyTo`), described in `.env.example`.
2. **Forgetting `pnpm db:migrate`.** While the database is empty, pages like sign-in, admin, and billing error out with missing tables. Migrations live in `drizzle/` and run with `pnpm db:migrate`; on Vercel, the build command in `vercel.json` runs them automatically. Rerun it whenever you switch databases or pull new migrations.
3. **If you change `drizzle/`, run `pnpm migrations:check` too.** It checks offline that the migration metadata is consistent (numbers contiguous from 0, `when` strictly increasing, no duplicate tags, snapshot chain closed). A migration whose `when` isn't strictly increasing gets **silently skipped** by drizzle on a database that already has a migration ledger (no error, no retry, and production is simply missing the tables). This happened once in the repository, which is why CI runs this check on every PR.
4. **Database tests in `pnpm test` are "silently skipped".** Without `DATABASE_URL_TEST`, the tests that need a database are skipped as a group and the exit code is still 0 (the output says they were skipped). In `.env.example` this line is enabled by default and points at the same database as `DATABASE_URL`, so if you copied it per the checklist the full suite runs — test data is written into your dev database; to keep them apart, point it at a separate database.
5. **`SKIP_ENV_VALIDATION=1` has no effect at production runtime.** `next build`, `next start`, and Docker all run with `NODE_ENV` set to `production`, where variable validation is enforced — no environment variable lets you "skip required values". It's only a convenience for local development.
6. **Email: only `resend` is allowed at production runtime.** Locally the default is `console` (the whole email is printed in the terminal); setting it to `console` / `file` at production runtime fails at startup — that would mean writing sign-in codes into server logs or onto disk. To run a production build locally: `ALLOW_NON_RESEND_EMAIL=1 EMAIL_TRANSPORT=console pnpm build`.
7. **You can't check out while a paid plan still has `prod_placeholder_*`.** Clicking buy returns `plan_not_configured`. After creating the products at your payment provider, put the real IDs into `billing.plans[*].providerProductId` in `site.config.ts`, or override them with the variables for the provider in effect: `CREEM_PRODUCT_ID_PRO` / `CREEM_PRODUCT_ID_LIFETIME` (Creem), `STRIPE_PRICE_ID_*` (Stripe), `LEMONSQUEEZY_VARIANT_ID_*` (Lemon Squeezy) or `WAFFO_PRODUCT_ID_*` (Waffo Pancake).
8. **Commit messages must follow Conventional Commits.** `pnpm install` installed git hooks that run ESLint / Prettier on staged files and check the commit message with commitlint when you commit: `git commit -m "update"` is rejected, and only something like `feat: …` / `fix: …` / `docs: …` gets through.

## Next steps

| What you want to do                                                                | Where to look                                                                |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Change the config (brand color, toggles, plans, navigation, rate limit thresholds) | The README's [Configuration](../README.md#configuration)                     |
| Launch (domain, environment variables, external accounts per module)               | The README's [Launch checklist](../README.md#launch-checklist)               |
| Upgrade to a new template version (bug fixes, new modules)                         | [UPGRADING.md](../UPGRADING.md) (directory boundaries are in there too)      |
| Where app features go and how to call the kit                                      | [Directory boundaries in UPGRADING.md](../UPGRADING.md#directory-boundaries) |
| Build your app with Claude Code / Cursor                                           | [docs/agent-guide.md](agent-guide.md)                                        |
| Add a language                                                                     | [docs/i18n.md](i18n.md)                                                      |
| Change UI styles, add components                                                   | [docs/design.md](design.md)                                                  |
| Switch payment providers, add a fourth provider                                    | [docs/billing.md](billing.md)                                                |
