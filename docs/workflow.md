# 开发流程

## 硬规则

1. **不在 `main` 上提交。** 所有改动都走 PR 合入。
2. **一个任务 = 一个分支 = 一个 worktree = 一个 PR。** 任务定义见 [tasks/README.md](tasks/README.md)。
3. **worktree 放在项目同级目录，命名 `sass-<topic>`。** `<topic>` 用任务的 topic 字段。
4. **每个 PR 合入后 `main` 必须可用**：CI 全绿，且不依赖尚未合入的任务。

## 命名

| 项       | 规则                                                        | 例子                                  |
| -------- | ----------------------------------------------------------- | ------------------------------------- |
| topic    | 小写 kebab-case，来自任务表                                 | `i18n`                                |
| 分支     | `<type>/<topic>`，type 取 `feat` / `fix` / `docs` / `chore` | `feat/i18n`                           |
| worktree | `../sass-<topic>`                                           | `../sass-i18n`                        |
| PR 标题  | `<任务ID> <type>: <描述>`                                   | `T104 feat: next-intl locale routing` |
| 提交信息 | Conventional Commits                                        | `feat(i18n): add locale switcher`     |

## 开始一个任务

在主仓库目录（`sass/`）下执行：

```bash
git fetch origin
git worktree add ../sass-<topic> -b <type>/<topic> origin/main
cd ../sass-<topic>
pnpm install   # T101 合入之后才有
```

开工前确认任务的依赖都已合入 `main`。

## 提交前的检查

`pnpm install` 会通过 `prepare` 脚本装好 git 钩子（husky，`.husky/`）：

- `pre-commit`：lint-staged 只处理暂存的文件，代码文件先 `eslint --fix` 再 `prettier --write`，其他文件 `prettier --write`（配置在 `lint-staged.config.mjs`）。ESLint 报错时提交中止，暂存区恢复原样。
- `commit-msg`：commitlint 检查提交信息是否符合 Conventional Commits（`commitlint.config.mjs`），例如 `feat(i18n): add locale switcher`。合并提交会跳过。

钩子只挡本地提交，CI 仍然完整跑一遍 lint、format、typecheck、test。临时跳过用 `git commit --no-verify`，但 CI 不会放过。

随包文件（代码、注释、测试标题、脚本输出、买家文档）不许有中文：提交前跑 `pnpm english:check`，CI 的 `static` job 也跑。范围按 `scripts/release-package.sh` 的 `exclude_paths` 取，界面中文只放 `messages/zh.json`；确实需要中文的那一行（测试数据、处理中文的代码）行尾加 `english-check-allow: <原因>`，写法见 `scripts/check-english.mjs` 开头。买家项目里这条只查 `src/core/`（按有没有 `docs/tasks/` 区分）。

### 改数据库 schema

改 `src/core/db/schema/` 之后用 `pnpm db:generate` 生成迁移，生成的 SQL 文件不要手工改内容
（改了也会被当成新迁移的同一份 `when`，已经跑过的库不会重跑）。迁移器判断「要不要执行」只比较
`drizzle/meta/_journal.json` 的 `when` 和账本里的 `created_at`：`when` 比账本最大值小的迁移
在已有数据的库上会被**静默跳过**，线上缺表直到构建挂掉才发现（2026-09 出过一次）。

提交前跑 `pnpm migrations:check`（CI 也会跑）：检查 `idx` 连续、`when` 严格递增、tag 不重号、
快照链闭合。报错照脚本开头的说明修，并在空库上 `pnpm db:migrate` 验一遍。

### 本地跑 e2e

```bash
EMAIL_TRANSPORT=file E2E_PORT=3100 \
  ADMIN_EMAILS=e2e-admin-desktop@example.com,e2e-admin-mobile@example.com,e2e-admin-acquisition-desktop@example.com,e2e-admin-acquisition-mobile@example.com,e2e-admin-status-desktop@example.com,e2e-admin-status-mobile@example.com,e2e-admin-flags-desktop@example.com,e2e-admin-flags-mobile@example.com \
  BILLING_PROVIDER=fake BILLING_SUCCESS_TIMEOUT_MS=8000 \
  CREEM_PRODUCT_ID_PRO=prod_ci_fake_pro CREEM_PRODUCT_ID_LIFETIME=prod_ci_fake_lifetime \
  SITE_NAME="CI Site" SITE_DOMAIN=ci.example.test \
  SITE_LEGAL_NAME="CI Legal Entity" SITE_EMAIL_FROM=noreply@ci.example.test \
  SITE_CONTACT_EMAIL=support@ci.example.test \
  npx playwright test
```

上面这组就是 `.github/workflows/ci.yml` 里那个 `env:` 在本地对应的部分，**整组照抄**：
少一条不一定报错 —— 有的会红（见下），有的只是让整块用例被**静默跳过**（跑完看着绿，其实没测）；
抄一半则是自相矛盾的断言。`.env.local` 里的 `DATABASE_URL` / `DATABASE_URL_TEST` /
`BETTER_AUTH_SECRET` 照旧生效，不用写进命令 —— `playwright.config.ts` 会加载它，
且不覆盖命令行上已有的值。

- `EMAIL_TRANSPORT=file` 是必须的：本地默认是 `console`，验证码只打到服务端终端，e2e 从 `.tmp/emails/` 读不到（CI 里由 workflow 设置）。
- `ADMIN_EMAILS` 给 `admin.spec.ts` 和 acquisition / status / flags 三个套件用；不设的话管理员登录后侧边栏没有后台入口（或被 `requireAdmin` 拦成 404），用例会卡在点击上。**这份名单要和 `.github/workflows/ci.yml` 的那一行一致**，少了谁就只有本地红、CI 绿。
- `BILLING_PROVIDER=fake` 让站点用站内的假服务商：`e2e/pricing.spec.ts` 那条「结账 → webhook → 积分到账」的链路全靠它，而那个文件开头就是 `test.skip(process.env.BILLING_PROVIDER !== "fake", …)` —— **不设不会红，是整条链路静默跳过**，覆盖没了而汇总依然全绿。不设时站点还按 `site.config.ts` 里的真实服务商启动，`e2e/billing.spec.ts` 退回「未配置」分支。
- `CREEM_PRODUCT_ID_PRO` / `CREEM_PRODUCT_ID_LIFETIME`：出厂的产品 ID 是占位值，`src/core/billing/checkout.ts` 的 `PLACEHOLDER_PRODUCT` 判据会把结账挡成 `plan_not_configured`（503）。只设了 `BILLING_PROVIDER=fake`、忘了这两条，`pricing.spec.ts` 的购买流程就会红在 `buy()` 那一步 —— 点完套餐页面不动。
- `BILLING_SUCCESS_TIMEOUT_MS`：成功页默认等 webhook 60 秒，`pricing.spec.ts` 自己的等待上限也按它算（`timeoutMs + 5000`），不设时会超过 Playwright 默认的 30 秒用例上限。
- `SITE_NAME` / `SITE_DOMAIN` / `SITE_LEGAL_NAME` / `SITE_EMAIL_FROM` / `SITE_CONTACT_EMAIL` 和上面那两个产品 ID 是**同一组**：`e2e/onboarding.spec.ts` 的 `placeholdersGone` 按「出厂占位值还在不在」分叉断言，只设一半（比如设了产品 ID、没设 `SITE_NAME`）两边都不成立 —— 清单里定价那步已经是 done，断言却按「占位值还在」算，于是清单那几条用例自相矛盾地红。
- 单独跑某个套件：`pnpm test:e2e:acquisition`（还有 `test:e2e:flags`），它们各自带 config，同样认上面的环境变量。
- `E2E_PORT` 换一个端口，避免和你正在跑的 `pnpm dev`（默认 3000）撞车 —— `reuseExistingServer` 会直接复用那个服务器，测的就不是当前 worktree 的代码。
- `ci.yml` 里还有三条**本地用不上**的：`ALLOW_FAKE_BILLING`、`ALLOW_UNRATELIMITED`、`ALLOW_NON_RESEND_EMAIL` —— 都是生产运行时的闸门（`NODE_ENV=development` 下 fake 本来就放行；缺 Redis 只在自托管生产才拒绝请求；`console` / `file` 两种邮件只在生产运行时才需要显式放行），本地 dev 不是生产。想在本地按生产构建跑一遍（`pnpm build` 后 `CI=1 npx playwright test`，那时 webServer 换成 `pnpm start`）就得把这三条也补上。

如果所有页面突然一起报 `SyntaxError: Unexpected non-whitespace character after JSON`，那是 `.next/dev/` 里的缓存被中断的 dev server 写坏了（不是代码问题）：`rm -rf .next` 重来。

## 提交 PR

开 PR 前先 rebase 到最新的 `main`：

```bash
git fetch origin
git rebase origin/main
git push -u origin <type>/<topic>   # rebase 过已推送的分支用 --force-with-lease
gh pr create --base main --title "<任务ID> <type>: <描述>" --body-file <说明文件>
```

PR 标题和描述统一用英文（和随包内容同一口径），描述按 [`.github/pull_request_template.md`](../.github/pull_request_template.md) 的结构填；模板随包交付，买家项目也会用它，所以里面不写任务 ID 和内部文档。rebase 后补的修改并进原有各节，不要在末尾另起一节，更不要换一种语言接着写。需要包含：

- 对应的任务 ID，以及任务文档的链接
- 验收项逐条勾选
- 测试方式和结果
- 新增的 env 或外部依赖（如果有）

**同一个 PR 里要把任务表中该任务的状态改成 `done`。**

PR 挂着期间 `main` 往前走了（别的 worktree 先合入），合入前要再 rebase 一次，等 CI 在新基线上重新跑绿。两个原因：

- 几乎每个 PR 都改 `docs/tasks/README.md` 的状态行，基于旧 `main` 的分支最容易在这里冲突。
- 语义冲突：git 能自动合并、文本上没冲突，合进去行为却不对（比如对方改了你调用的函数）。只有在最新 `main` 上重跑 CI 才看得出来。

分支保护开了「Require branches to be up to date」，落后 `main` 时合并按钮是灰的，这条由 GitHub 强制。

## 合入与清理

- 用 squash merge，合入后删除远程分支。**`--subject` 必须写 PR 标题**：不写时 `gh` 会拿分支上的提交信息当 squash 提交的标题，`main` 上那条就丢了任务 ID（#169、#171 都是这样进去的）。

```bash
gh pr merge <PR 号> --squash --delete-branch --subject "<任务ID> <type>: <描述> (#<PR 号>)"
```

- 清理本地（先在 worktree 里 `git status` 确认没有未提交的改动）：

```bash
cd ../sass
git worktree remove ../sass-<topic>
git branch -D <type>/<topic>   # squash 后分支不是 main 的祖先，-d 会拒绝
git pull --ff-only
```

## GitHub 仓库设置

`main` 的分支保护（Settings → Branches，2026-09-30 起生效）：

- 必须通过 PR 合入（Require a pull request before merging），不要求 approval
- 要求 CI 通过（Require status checks: `ci`）：只选 `ci` 这一个，它在其余 job 全部通过后才变绿
- 合并前分支必须与 `main` 同步（Require branches to be up to date before merging）：至少选中一个状态检查它才生效
- 禁止 force push、禁止删除
- 不对管理员强制（Do not allow bypassing 未勾），仓库所有者仍可绕过，只在紧急修复时用

核对当前设置：`gh api repos/linonward/sass/branches/main/protection/required_status_checks`，`checks` 里应该有 `ci`、`strict` 为 `true`。
