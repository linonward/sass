# Third-party components and licenses

This file lists the third-party components the template uses and their licenses. The template's **own code** is not covered here; it is licensed under the proprietary EULA in [LICENSE](LICENSE) at the repository root.

- Counted on: 2026-09-27. This version reran the same commands on baseline `3c59e36`: the numbers in both distribution tables are **unchanged** from the previous version (baseline `358d00d`). What changed are five rows in "Direct dependencies" — react / react-dom / `@types/react` / `@types/react-dom` / typescript. Dependabot upgraded them after this file was last updated, and those five rows still showed the pre-upgrade versions. The previous version's production-tree numbers were smaller than earlier versions mainly because the `shadcn` chain moved into `devDependencies`.
- 2026-09-28: added a row for `@vitest/coverage-v8` (5.0.2, dev, MIT) to "Direct dependencies" — vitest's coverage provider, added along with the CI coverage thresholds. The note at the time said "its transitive dependencies are already in the tree"; **that was wrong**: its `@bcoe/v8-coverage`, `ast-v8-to-istanbul`, `@vitest/istanbul-lib-coverage` / `@vitest/istanbul-lib-report` and others really are newly installed packages. The next entry corrects the numbers as well.
- 2026-09-28: added a row for `stripe` (22.6.2, prod, MIT) to "Direct dependencies" — the official Stripe Node SDK, used for Stripe payments (a provider added alongside Creem; see the "Payments (Creem / Stripe)" section of the README). It has no transitive dependencies. Both distribution tables were rerun on the same macOS machine and updated this time: the production tree gained only this 1 MIT package (540 → 541 entries), and the full tree gained 8 MIT packages (+1 is stripe; the other 7 are the transitive dependencies of `@vitest/coverage-v8` that the previous entry missed). The package counts in every other row are unchanged.
- Method: `pnpm licenses list` (full) and `pnpm licenses list --prod` (production dependencies only). Both read the dependencies installed in the repository at the versions locked in `pnpm-lock.yaml`.
- The numbers change when dependencies are upgraded, and this file does not update itself — when you change dependencies, rerun the commands above and update as needed. **The "Direct dependencies" section no longer relies on anyone remembering**: `pnpm notices:check` (`scripts/check-notices.mjs`) compares every version and dependency type against `pnpm-lock.yaml`, CI runs it on every PR, and it fails on any mismatch.
- This file describes the situation; it is **not legal advice**. Have a lawyer review it before you sell commercially (see the "License" section of the README).
- 2026-10-01: added a row for `streamdown` (2.6.0, prod, Apache-2.0) to "Direct dependencies" — renders Playground replies as markdown with copy buttons on code blocks. Both distribution tables were rerun on the same macOS machine. Measured on `main` before the change the tree was already off by one from the previous entry (full tree ISC 34, not 35; production tree 542 entries, not 541); on top of that `streamdown` adds 31 MIT + 2 Apache-2.0 packages to the full tree (1017 → 1050) and 34 to the production tree (542 → 576), all under licenses already listed.

## Full dependency tree

Includes `dependencies`, `devDependencies` and all of their transitive dependencies, counting the platform-specific optional dependencies actually installed:

| License (SPDX)            | Packages |
| ------------------------- | -------- |
| MIT                       | 874      |
| Apache-2.0                | 91       |
| ISC                       | 34       |
| BSD-2-Clause              | 16       |
| BSD-3-Clause              | 12       |
| BlueOak-1.0.0             | 6        |
| MIT-0                     | 3        |
| MPL-2.0                   | 3        |
| CC0-1.0                   | 2        |
| LGPL-3.0-or-later         | 1        |
| Apache-2.0 AND MIT        | 1        |
| Python-2.0                | 1        |
| CC-BY-4.0                 | 1        |
| Unlicense                 | 1        |
| (AFL-2.1 OR BSD-3-Clause) | 1        |
| FSL-1.1-Apache-2.0        | 1        |
| 0BSD                      | 1        |
| (MIT OR CC0-1.0)          | 1        |
| **Total**                 | 1050     |

How to read this: 1018 is the number of "package name × license" entries. On disk there are 1122 "package@version" entries (a package with several versions takes one line per version), and deduplicated by name there are 1014 packages.

**There are no strong copyleft licenses such as GPL, AGPL or SSPL.** 4 packages have copyleft characteristics in total: 1 LGPL-3.0-or-later and 3 MPL-2.0, each explained in the next section. Everything else is permissive (MIT / Apache-2.0 / ISC / BSD / MIT-0 / 0BSD / BlueOak / Unlicense / CC0 / Python-2.0 / dual licenses where you pick one).

## Production dependency tree

`pnpm licenses list --prod`: 541 entries, 539 package names.

| License (SPDX)            | Packages |
| ------------------------- | -------- |
| MIT                       | 468      |
| Apache-2.0                | 62       |
| ISC                       | 18       |
| BSD-3-Clause              | 7        |
| BSD-2-Clause              | 7        |
| BlueOak-1.0.0             | 5        |
| Python-2.0                | 1        |
| CC-BY-4.0                 | 1        |
| Unlicense                 | 1        |
| (AFL-2.1 OR BSD-3-Clause) | 1        |
| CC0-1.0                   | 1        |
| MIT-0                     | 1        |
| FSL-1.1-Apache-2.0        | 1        |
| 0BSD                      | 1        |
| (MIT OR CC0-1.0)          | 1        |
| **Total**                 | 576      |

Two things to note:

- **`--prod` counts neither devDependencies nor optional dependencies**, so none of the three packages with copyleft characteristics appear in this table, but for different reasons: sharp / libvips (LGPL) is an **optional dependency** of `next` (a real deployment installs it: on Vercel, Next uses sharp for image optimization); lightningcss (MPL) comes in through the devDependencies of Tailwind and vitest; axe-core (MPL) comes from an ESLint plugin and is only used during lint. Looking at this table alone would miss the first two, which is why each one is explained in the next section.
- If your CI runs `pnpm install` without `--prod`, it installs the full tree, and both tables apply.

## Licenses that need a separate note

### LGPL-3.0-or-later — `@img/sharp-libvips-*` (1 package)

Dependency chain: `next@16.3.6` → (optional dependency) `sharp@0.35.4` → `@img/sharp-darwin-arm64@0.35.4` → `@img/sharp-libvips-darwin-arm64@1.3.3`.

- **The `sharp` package itself is Apache-2.0**; what is LGPL is the **prebuilt libvips binary** it depends on, `@img/sharp-libvips-*`. The machine this was counted on installs `-darwin-arm64`; `@img/sharp-libvips-linux-x64` / `-linux-arm64` on the npm registry were checked separately and are also `LGPL-3.0-or-later`.
- Why this is acceptable for SaaS / self-hosted use:
  - LGPL copyleft covers only the library **itself**, not the application that calls it. The template does not modify it and does not statically link it into its own code — sharp calls it as a separate dynamic library.
  - LGPL obligations fall on **whoever distributes the library**: include the full license text and provide the library's source on request. In a SaaS deployment the binary is installed on the operator's own servers and is not distributed to end users with the product, so this obligation is not triggered.
  - If you do need to distribute it (for example, shipping a Docker image to a customer), keep the binary unmodified: the full license text is inside the package, and source requests can point to the package's published location.
  - This describes common practice and is not legal advice.

### MPL-2.0 — `lightningcss`, `lightningcss-darwin-arm64`, `axe-core` (3 packages)

- `lightningcss` comes in through devDependencies, along two paths: `@tailwindcss/postcss` → `@tailwindcss/node` (compiles CSS at build time, the Tailwind 4 pipeline), and `vitest` → `vite` (testing and transpiling). The two versions (1.32.0 / 1.33.0) come from these two paths respectively.
- `axe-core` ← `eslint-plugin-jsx-a11y`, only used during `pnpm lint`.
- MPL-2.0 is a **file-level** copyleft: it only requires that "modified MPL files" stay available under the MPL. It does not affect the license of other files in the same project and does not require publishing the calling code. The template does not modify these packages, and they are all build / lint-time tools that don't end up in the build output of your product. Only if you actually modify these packages' source (rare) do you need to publish the modified files under the MPL.

### FSL-1.1-Apache-2.0 — `sentry@0.44.1` (Sentry CLI, 1 package)

Dependency chain: `@sentry/nextjs@11.0.0` → `@sentry/bundler-plugins@11.0.0` → `sentry@0.44.1`.

- FSL is **not an OSI-approved open source license**; it is source-available: it allows use, copying, modification and redistribution, except for building a **competing commercial product or service** (the "Competing Use" definition in the package's `LICENSE.md`). Each version automatically converts to Apache-2.0 two years after its release.
- The template's usage is entirely within what's allowed: it only uploads source maps **at build time**, and only when you have set all three of `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` (see `canUploadSourceMaps` in `next.config.ts`). That falls under "your internal use and access", which the license lists explicitly; the template does not modify it, does not distribute it as part of the product, and does not offer a service that competes with it.
- If you don't use Sentry, this chain never runs.

### Others worth naming that create no obligations

| License                                                          | Package                                | Notes                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CC-BY-4.0                                                        | `caniuse-lite`                         | Browser support dataset, read at build time via `browserslist` / `next` to decide CSS / JS compatibility targets. CC-BY requires attribution, and this entry is that attribution; the data is not distributed with your build output. |
| Python-2.0                                                       | `argparse`                             | PSF license (permissive), from `js-yaml` (parses configuration at build time).                                                                                                                                                        |
| (AFL-2.1 OR BSD-3-Clause)                                        | `json-schema`                          | Dual license; BSD-3-Clause is the one that applies (from `@ai-sdk/provider`).                                                                                                                                                         |
| Unlicense                                                        | `fast-sha256`                          | Public domain dedication (from `standardwebhooks`, used to verify Creem webhook signatures).                                                                                                                                          |
| CC0-1.0                                                          | `language-subtag-registry`, `mdn-data` | Public domain dedication (language subtag data, MDN's CSS data); no attribution required.                                                                                                                                             |
| 0BSD / BlueOak-1.0.0 / MIT-0 / ISC / BSD-2-Clause / BSD-3-Clause | See the tables above                   | All permissive; they require keeping the copyright and license notices and impose no other obligations.                                                                                                                               |

## Direct dependencies

`package.json` has 47 `dependencies` + 32 `devDependencies`, 79 in total. The versions are the ones locked when this was counted.

### MIT (55)

| Package                           | Version | Type |
| --------------------------------- | ------- | ---- |
| `@base-ui/react`                  | 1.8.0   | prod |
| `@commitlint/cli`                 | 21.2.3  | dev  |
| `@commitlint/config-conventional` | 21.2.3  | dev  |
| `@content-collections/cli`        | 0.1.9   | dev  |
| `@content-collections/core`       | 0.15.3  | dev  |
| `@content-collections/next`       | 0.2.11  | dev  |
| `@neondatabase/serverless`        | 1.1.0   | prod |
| `@react-email/ui`                 | 6.11.0  | dev  |
| `@sentry/nextjs`                  | 11.0.0  | prod |
| `@t3-oss/env-nextjs`              | 0.13.11 | prod |
| `@tailwindcss/postcss`            | 4.3.3   | dev  |
| `@tailwindcss/typography`         | 0.5.20  | dev  |
| `@testing-library/dom`            | 10.4.2  | dev  |
| `@testing-library/react`          | 16.3.3  | dev  |
| `@types/node`                     | 24.19.0 | dev  |
| `@types/pg`                       | 8.23.1  | dev  |
| `@types/react`                    | 19.3.0  | dev  |
| `@types/react-dom`                | 19.3.0  | dev  |
| `@types/ws`                       | 8.18.1  | dev  |
| `@upstash/ratelimit`              | 2.2.0   | prod |
| `@upstash/redis`                  | 1.39.0  | prod |
| `@vercel/analytics`               | 2.0.1   | prod |
| `@vercel/otel`                    | 2.1.3   | prod |
| `@vitejs/plugin-react`            | 6.1.1   | dev  |
| `@vitest/coverage-v8`             | 5.0.2   | dev  |
| `@waffo/pancake-ts`               | 0.25.0  | prod |
| `auth`                            | 1.7.6   | dev  |
| `better-auth`                     | 1.7.6   | prod |
| `cn`                              | 0.4.0   | prod |
| `creem`                           | 1.13.0  | prod |
| `drizzle-kit`                     | 0.31.11 | dev  |
| `eslint`                          | 9.39.5  | dev  |
| `eslint-config-next`              | 16.3.6  | dev  |
| `eslint-config-prettier`          | 10.1.8  | dev  |
| `husky`                           | 9.1.7   | dev  |
| `jsdom`                           | 30.1.1  | dev  |
| `lint-staged`                     | 17.6.0  | dev  |
| `next`                            | 16.3.6  | prod |
| `next-intl`                       | 4.14.7  | prod |
| `next-themes`                     | 0.4.6   | prod |
| `pg`                              | 8.23.0  | prod |
| `prettier`                        | 3.9.9   | dev  |
| `prettier-plugin-tailwindcss`     | 0.8.1   | dev  |
| `react`                           | 19.3.0  | prod |
| `react-dom`                       | 19.3.0  | prod |
| `react-email`                     | 6.11.0  | prod |
| `resend`                          | 6.30.0  | prod |
| `shadcn`                          | 4.21.0  | dev  |
| `sonner`                          | 2.0.8   | prod |
| `streamdown`                      | 2.6.0   | prod |
| `stripe`                          | 22.6.2  | prod |
| `tailwindcss`                     | 4.3.3   | dev  |
| `tw-animate-css`                  | 1.4.0   | prod |
| `vitest`                          | 5.0.2   | dev  |
| `ws`                              | 8.22.0  | prod |
| `zod`                             | 4.6.5   | prod |

### Apache-2.0 (21)

| Package                          | Version  | Type |
| -------------------------------- | -------- | ---- |
| `@ai-sdk/alibaba`                | 2.0.56   | prod |
| `@ai-sdk/anthropic`              | 4.0.65   | prod |
| `@ai-sdk/google`                 | 4.0.82   | prod |
| `@ai-sdk/openai`                 | 4.0.78   | prod |
| `@ai-sdk/provider`               | 4.0.18   | prod |
| `@ai-sdk/react`                  | 4.0.119  | prod |
| `@aws-sdk/client-s3`             | 3.1141.0 | prod |
| `@aws-sdk/s3-request-presigner`  | 3.1141.0 | prod |
| `@opentelemetry/api`             | 1.9.1    | prod |
| `@opentelemetry/api-logs`        | 0.222.0  | prod |
| `@opentelemetry/instrumentation` | 0.222.0  | prod |
| `@opentelemetry/resources`       | 2.11.0   | prod |
| `@opentelemetry/sdk-logs`        | 0.222.0  | prod |
| `@opentelemetry/sdk-metrics`     | 2.11.0   | prod |
| `@opentelemetry/sdk-trace-base`  | 2.11.0   | prod |
| `@playwright/test`               | 1.63.0   | dev  |
| `@vercel/speed-insights`         | 2.0.0    | prod |
| `ai`                             | 7.0.116  | prod |
| `class-variance-authority`       | 0.7.1    | prod |
| `drizzle-orm`                    | 0.45.3   | prod |
| `typescript`                     | 6.0.3    | dev  |

### ISC (1)

| Package        | Version | Type |
| -------------- | ------- | ---- |
| `lucide-react` | 1.48.0  | prod |

### No `license` field (1)

| Package                    | Version | Type | Actual license                                                                                                                                                           |
| -------------------------- | ------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@content-collections/mdx` | 0.2.2   | prod | Its `package.json` has no `license` field, but the package ships an MIT `LICENSE` (Copyright (c) 2024 Sebastian Sdorra), and `pnpm licenses list` also counts it as MIT. |

## Reproducing and maintaining this file

```bash
pnpm install --frozen-lockfile   # make sure the lockfile versions are installed
pnpm notices:check               # check whether this file has drifted from the lockfile (CI runs this too)
pnpm notices:fix                 # rewrite only drifted versions in the direct-dependency table to the lockfile, then run prettier (the dependabot-notices workflow does this on Dependabot PRs)
pnpm licenses list               # full distribution (the first table in this file)
pnpm licenses list --prod        # production dependencies only (the second table)
pnpm licenses list --json        # machine-readable, for computing the distribution yourself
```

The full license text of every package is installed locally along with `node_modules`, at `node_modules/<package-name>/LICENSE*`. After changing dependencies, rerun the commands above, check the numbers in the two tables, and then decide whether this section needs updating.

`pnpm notices:check` covers two things: it checks every row of "Direct dependencies" against `pnpm-lock.yaml` (version, prod / dev type, and any extra or missing rows), and it confirms that every license reported by `pnpm licenses list` appears in this file and that there is no strong copyleft such as GPL / AGPL / SSPL. It **does not compare the package counts in the two distribution tables**: those numbers depend on the optional dependencies installed for the current platform (`@swc/core-*`, `@img/sharp-libvips-*`, `lightningcss-*` …), so numbers computed on macOS will never match on Linux CI, and the script only prints the counts for a person to check. If the script reports a license it hasn't seen before when you change dependencies, add a row to both distribution tables and explain under "Licenses that need a separate note" whether it carries obligations.

Your obligations as a buyer are not affected by the template EULA: third-party components are licensed to you directly by their respective authors under their own licenses; see section 7 of [LICENSE](LICENSE).
