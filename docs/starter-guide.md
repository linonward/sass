# 模板使用指南

写给刚拿到模板的人：从零到上线怎么走，每一步敲什么命令、点哪个按钮、会看到什么。

这是一份**纯文字**指南（没有截图和视频）：外部界面上的步骤都写清了按钮位置和结果，本机的步骤都是可以直接复制的命令。需要展开的细节都链到 `README.md` 的对应小节，这里不重复一遍 —— 同一件事只有一处说明，改起来不会两边漂移。

本文件随买家分发包一起交付（`scripts/release-package.sh` 打出的包里就有它）。

## 10 分钟从零到上线

目标：在一台**空机器**上，10 分钟从零走到「登录进自己的仪表盘」。这 10 分钟到的是「本地跑通」；部署到线上见下面的[完整走查](#部署到-vercel)，那一步的耗时主要花在申请外部账号上。

前置（缺一样先装）：

| 需要   | 版本                                            | 怎么装                                                |
| ------ | ----------------------------------------------- | ----------------------------------------------------- |
| Node   | 24（`.nvmrc` 里写的就是这个）                   | nodejs.org，或用 fnm / nvm 按 `.nvmrc` 装             |
| pnpm   | 12（版本见 `package.json` 的 `packageManager`） | `corepack enable pnpm`                                |
| Docker | 近期版本                                        | 只用来起一个本地 Postgres；本机已有 Postgres 可以跳过 |

10 分钟是「照抄命令、一路没卡壳」的量；第一次边读边做，30 分钟内也应该能走完。卡住就在那一步停下来 —— 每步都写了怎么验证。

- [ ] **1. 建仓库并克隆（约 3 分钟）**

  在模板仓库页面点 **Use this template**（右上角、`Code` 按钮左边）→ **Create a new repository**，选 Owner、填仓库名、可见性选 **Private**，点 **Create repository**；几秒后你会落到自己的新仓库首页，原本 `Use this template` 的位置变成了 `Code`。按钮顺序和每条路会拿到什么，见下面的[建仓库并克隆](#建仓库并克隆)。

  ```bash
  git clone https://github.com/<你的账号>/<仓库名>.git && cd <仓库名>
  git remote add upstream https://github.com/linonward/sass.git   # 以后用它合并模板更新，见 UPGRADING.md
  ```

  走 zip 分发的买家跳过这一步，改成在自己的目录里建仓库并提交一次基线（zip 里没有模板作者的内部文档，也没有 `upstream` 可加）：

  ```bash
  git init && git add -A && git commit -m "chore: import template"
  ```

  以后模板出新版本时，卖家会给你一个差量更新包，用 `scripts/apply-template-update.sh` 应用 —— 步骤见 [UPGRADING.md](../UPGRADING.md)。

  **GitHub 这条路径还要多做一件事：删掉模板作者的内部文档**（`AGENTS.md`、`CLAUDE.md`、`docs/plan.md`、`docs/workflow.md`、`docs/tasks/`、`docs/go-to-market.md`、`docs/competitive-landscape.md`）。命令和逐条理由在 README 的[第 1 步：用模板建仓库](../README.md#1-用模板建仓库)。**别跳过**：`AGENTS.md` 会被 Claude Code 这类工具自动加载，模板作者的工作流会被当成你项目的规则来执行。

  验证：`git remote -v` 里能看到 `upstream` 那一行；GitHub 路径再确认 `ls docs/tasks` 报 `No such file or directory`。

- [ ] **2. 装依赖、写 `.env.local`（约 2 分钟）**

  ```bash
  pnpm install
  cp .env.example .env.local
  openssl rand -base64 32          # 复制输出，下面要填进 BETTER_AUTH_SECRET
  ```

  然后编辑 `.env.local`，本地只有两项是必填的：

  - `DATABASE_URL`：默认值 `postgres://postgres:postgres@localhost:5432/postgres` 就是下一步那个 Docker 库，直接用；
  - `BETTER_AUTH_SECRET`：填上面 `openssl` 的输出（**少于 32 个字符启动就报错**）。

  其余变量留着不动 —— 本地不需要任何外部账号，没配 key 的模块各自跳过或返回 503（见[本地跑通](#本地跑通)）。

  验证：`pnpm install` 结束时没有 error（它顺带装好了 git 钩子）；`ls .env.local` 能看到文件。

- [ ] **3. 起本地 Postgres（约 1 分钟）**

  ```bash
  docker run -d --name sass-postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:18
  ```

  本机已有 Postgres 就跳过这行，把地址填进 `.env.local` 的 `DATABASE_URL`。

  验证：`docker ps` 里 `sass-postgres` 的状态是 `Up`（刚起来时是 `health: starting`，几秒后变）。

- [ ] **4. 建表：`pnpm db:migrate`（约 1 分钟）**

  ```bash
  pnpm db:migrate
  ```

  会看到 `[✓] migrations applied successfully!`。**这一步要在 `pnpm dev` 之前做**：库还没建表时，登录和后台页面会报缺表。重复执行是安全的（已执行过的迁移会跳过），换库、换机器、拉了新迁移之后都要重跑。

  验证：输出里有 `migrations applied successfully`。想看表建成了什么样：`pnpm db:studio`。

- [ ] **5. 起开发服务器：`pnpm dev`（约 1 分钟）**

  ```bash
  pnpm dev
  ```

  会看到 `▲ Next.js …`、`- Local: http://localhost:3000`、`- Environments: .env.local`、`✓ Ready`。打开 `http://localhost:3000` 就是落地页，标题是 `site.config.ts` 里的 `name`（出厂是 `Acme`）。

  同一个终端里还会多一段占位值警告，列出 4 个字段 —— **dev 只是警告，生产构建会直接失败**，见[最容易踩的坑](#最容易踩的坑)。缺必需变量时则相反：启动就报 `Invalid environment variables:` 并逐条列出变量名。

- [ ] **6. 登录，走一遍上手清单（约 2 分钟）**

  打开 `http://localhost:3000/sign-in`，填任意邮箱（`me@example.com` 就行，不需要真实存在），点 **Send code**。**验证码不会发到邮箱，而是打印在跑着 `pnpm dev` 的那个终端里**，形如：

  ```
  ──────── email (EMAIL_TRANSPORT=console) ────────
  To:       me@example.com
  Subject:  Your Acme sign-in code
  ...
  420041
  ```

  把 6 位数字填进 **Verification code**，点 **Sign in**。**第一次登录会先落到 `/onboarding`**：一页 Getting started 上手清单（出厂配置下五步），每一步的判定读的是你仓库里的配置 —— 品牌色、站点名、定价这三条会列出还没改的出厂值，发文章和部署没有可靠信号、自己勾。点 **Mark as done** 进 `/dashboard`，页头显示 `Signed in as <你的邮箱>` 就算本地跑通了；以后登录不再经过清单页，想回来从侧边栏的 **Product** 组进。

  dashboard 上是空状态（侧边栏分两组：**Main** 是 Dashboard / Playground / Invoices / Billing / Settings，**Product** 是 Getting started 和 Taglines 示例），**空的是正常的** —— 模板出厂的 dashboard 本来就是空的。

  想看有数据的样子：README 的[先看看有数据长什么样](../README.md#先看看有数据长什么样)（一条命令灌演示数据）。

走到这里，本地已经有一个能登录、能改配置的站点。接下来是「改成自己的」和「部署」：[完整走查](#完整走查从建仓库到上线)。

## 完整走查：从建仓库到上线

按顺序讲清四条路。本机的命令都在上面的 checklist 里，这里不重复；外部界面上的每一步都写了点哪里、会看到什么。

### 建仓库并克隆

两条交付路径，殊途同归：

| 路径                        | 你会拿到                                                 | 还要做什么                                                                              |
| --------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| GitHub「Use this template」 | 一个属于你的仓库，含模板作者的内部文档（`AGENTS.md` 等） | 克隆到本地、加 `upstream`、删掉内部文档；升级走 `git merge`                             |
| 购买后收到的 zip            | 一个目录，内部文档已经剔掉，多一份 `template.json`       | 解压、`git init` 并提交一次基线；升级走差量更新包（见 [UPGRADING.md](../UPGRADING.md)） |

GitHub 这条路的按钮顺序：

1. 打开模板仓库，点 **Use this template** → **Create a new repository**（在 `Code` 按钮左边的下拉里）。
2. 表单里选 **Owner**、填 **Repository name**、可见性选 **Private**（模板是按份售卖的专有许可，别开成公开仓库），点 **Create repository**。
3. 几秒后你会落到新仓库的首页：原本 `Use this template` 的位置变成了 `Code`，这一页就是你的仓库了。
4. 点 **Code** → **HTTPS** 复制地址，回本地 `git clone`（命令在 [checklist 第 1 步](#10-分钟从零到上线)）。
5. 加 `upstream`、删掉内部文档 —— 命令与逐条理由在 README 的[第 1 步](../README.md#1-用模板建仓库)。删完如果又看到 `AGENTS.md` / `CLAUDE.md` 回来，那一节末尾有解释（是 `next dev` 写的，不是你没删干净）。

### 本地跑通

[checklist 第 2–6 步](#10-分钟从零到上线)做完就是这个状态。几个值得知道的点：

- **本地不需要任何外部账号。** 邮件打印在终端（`EMAIL_TRANSPORT` 不填时本地默认 `console`，登录验证码就从这里看）；支付、限流、上传、AI 没配 key 时各自返回 503 或静默跳过。数据库是你自己起的那个 Docker 库。所以走上线流程之前，一个第三方服务都不用注册。
- **dashboard 空的是正常的**，模板里没有业务数据；想看出效果就灌一批演示数据（见 checklist 第 6 步的链接）。
- 本机其它常用命令（`pnpm test`、`pnpm lint`、`pnpm email:dev`、`pnpm db:studio` 等）在 README 的[本地开发](../README.md#本地开发)表格里。

### 改成自己的站点

上线前唯一必须改代码的环节，最少改这几处：

1. **`site.config.ts` 的 4 个占位值**：`name`、`domain`、`legal.companyName`、`email.fromAddress`。不改的话生产构建直接失败（见下节第 1 条）。
2. **其余站点配置**：品牌色、功能开关、法律信息、定价套餐、发件人、AI 模型。完整字段清单和每一项的作用在 README 的[改成自己的站点](../README.md#3-改成自己的站点)。
3. **文案与内容**：`messages/en.json`（页面文案）、`content/legal/`（法律页正文）、`content/blog/`（文章）、`public/`（你自己的 logo 和 Hero 图）。
4. **示例模块**：`src/features/example/`（一个扣积分的 Taglines 生成器）演示了业务代码怎么调用 `runAI`、`deductCredits`，以及怎么往 `dashboard.nav` 加菜单；看完就按[同一节](../README.md#3-改成自己的站点)里的清单删掉。

改完跑 `pnpm test` 和 `pnpm build` 确认没漏改 —— `build` 会把占位值、`messages` key 缺失这些问题替你查一遍。

### 部署到 Vercel

Vercel 的界面偶尔改版，找不到某个按钮时按名字找，流程不变。

1. 打开 vercel.com，用 GitHub 账号登录，点 **Add New…** → **Project**。
2. 在 **Import Git Repository** 列表里找到刚建的那个仓库，点 **Import**。列表里没有它：点列表下方的 **Adjust GitHub App Permissions**，把仓库加给 Vercel（详见 README [上线清单第 1 节](../README.md#1-vercel)）。
3. 你会看到 New Project 表单：**Framework Preset** 自动是 `Next.js`，**Build Command** 是 `pnpm db:migrate && pnpm build`（来自仓库根的 `vercel.json`）。都不用改。
4. **先别点 Deploy**：展开 **Environment Variables**，按 README [上线清单第 3 节](../README.md#3-环境变量)的表格把必需变量填上（至少 `DATABASE_URL`、`RESEND_API_KEY`、`BETTER_AUTH_SECRET`）。这一步要用的外部账号（Neon、Resend、Google、Creem……）按[已开启的模块](../README.md#4-按已开启的模块准备外部账号)准备，不必一次配齐，只配你开了的模块。
5. 点 **Deploy**。构建日志里会先跑 `pnpm db:migrate` 再 `next build`；**占位值没改或必需变量缺失时，构建会直接失败并列出是哪一个** —— 这是模板故意的，改完重新部署即可。迁移失败时线上仍是上一个版本。
6. 构建成功后 Vercel 给你一个 `*.vercel.app` 地址，打开确认首页能开。绑自己的域名（DNS 怎么填）见 README [上线清单第 2 节](../README.md#2-域名与-dns)。
7. 上线后的自检（两种登录方式、用测试卡买一次、后台能看到订单）见 README 的[第 6 步](../README.md#6-走一遍上线清单打开真实收款)。

## 最容易踩的坑

1. **4 个占位值不改，生产构建直接失败。** `site.config.ts` 的 `name`、`domain`、`legal.companyName`、`email.fromAddress` 还是出厂值时，`pnpm dev` 只打印一行警告，`pnpm build`（以及 Vercel 上的构建）会抛错并逐条列出字段名和改法。这套判断在 `src/core/config/sentinels.ts`：开发环境只警告，生产直接拦人，免得站点挂着 Acme 和 example.com 上线。想用环境变量覆盖（一套代码跑多个环境）：`SITE_NAME` / `SITE_DOMAIN` / `SITE_LEGAL_NAME` / `SITE_EMAIL_FROM`，`.env.example` 里有说明。
2. **忘了 `pnpm db:migrate`。** 库是空的时，登录、后台、账单这些页面会报缺表。迁移在 `drizzle/`，由 `pnpm db:migrate` 执行；Vercel 上由 `vercel.json` 的构建命令自动执行。换了库或拉了新迁移都要重跑一遍。
3. **改了 `drizzle/` 就顺手跑 `pnpm migrations:check`。** 它离线检查迁移元数据自洽（编号从 0 连续、`when` 严格递增、tag 不重号、快照链闭合）。`when` 不是严格递增的迁移，在已经有账本的库上会被 drizzle **静默跳过**（不报错、不重试，线上直接缺表），仓库里出过一次这样的事故，所以这条检查 CI 每个 PR 都跑。
4. **`pnpm test` 里数据库用例会「静默跳过」。** 没设 `DATABASE_URL_TEST` 时，需要数据库的用例整组跳过、退出码仍然是 0（输出里会写明跳过了）。想在本地跑全量：把 `.env.example` 里那行 `DATABASE_URL_TEST` 填进 `.env.local`。
5. **`SKIP_ENV_VALIDATION=1` 在生产运行时无效。** `next build`、`next start`、Docker 里 `NODE_ENV` 都是 `production`，变量校验强制生效 —— 一个环境变量换不来「跳过必填项」。它只在本地开发时方便。
6. **邮件：生产运行时只允许 `resend`。** 本地默认 `console`（整封信打印在终端）；生产运行时设成 `console` / `file` 会启动失败 —— 那等于把登录验证码写进服务端日志或磁盘。想在本地跑一次生产构建：`ALLOW_NON_RESEND_EMAIL=1 EMAIL_TRANSPORT=console pnpm build`。
7. **付费套餐还挂着 `prod_placeholder_*` 时不能结账。** 点购买会拿到 `plan_not_configured`。在 Creem 建好产品后，把真实 ID 填进 `site.config.ts` 的 `billing.plans[*].providerProductId`，或用 `CREEM_PRODUCT_ID_PRO` / `CREEM_PRODUCT_ID_LIFETIME` 覆盖。
8. **提交信息要符合 Conventional Commits。** `pnpm install` 装好了 git 钩子，提交时会用 ESLint / Prettier 处理暂存的文件、并用 commitlint 检查提交信息：`git commit -m "update"` 会被拦下，写成 `feat: …` / `fix: …` / `docs: …` 才放行。

## 下一步

| 想做的事                                     | 看哪里                                              |
| -------------------------------------------- | --------------------------------------------------- |
| 改配置（品牌色、开关、套餐、导航、限流阈值） | README 的[配置](../README.md#配置)                  |
| 上线（域名、环境变量、各模块的外部账号）     | README 的[上线清单](../README.md#上线清单)          |
| 升级到模板的新版本（修 bug、新模块）         | [UPGRADING.md](../UPGRADING.md)（目录边界也在里面） |
| 写业务功能放哪、怎么调用套件                 | [UPGRADING.md 的目录边界](../UPGRADING.md#目录边界) |
| 新增一门语言                                 | [docs/i18n.md](i18n.md)                             |
| 改界面样式、加组件                           | [docs/design.md](design.md)                         |
| 换支付商、加第四个支付商                     | [docs/billing.md](billing.md)                       |
