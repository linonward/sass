# sass

可复用的出海 SaaS 模板：改配置即可得到登录、支付（Creem）、积分、AI、多语言、SEO 等基础设施，只需编写业务功能。

v1 包含：邮箱验证码和 Google 登录、Creem 收款（订阅和一次性购买）、积分账本、AI（文字、图片、视频，按次扣积分）、文件上传（R2）、多语言、SEO、法律页、MDX 博客、后台。

- 方案：[docs/plan.md](docs/plan.md)
- 合并模板更新：[UPGRADING.md](UPGRADING.md)
- 任务路径：[docs/tasks/README.md](docs/tasks/README.md)
- 开发流程：[docs/workflow.md](docs/workflow.md)

## 快速开始：从 fork 到上线

按顺序做，每一步都能单独验证。预计耗时是熟悉流程后的参考值，第一次做可以在"实际"一栏记下来，卡住的地方补进本文档。

| #   | 步骤                                                          | 预计     | 实际 |
| --- | ------------------------------------------------------------- | -------- | ---- |
| 1   | [用模板建仓库](#1-用模板建仓库)                               | 5 分钟   |      |
| 2   | [本地跑起来](#2-本地跑起来)                                   | 15 分钟  |      |
| 3   | [改成自己的站点](#3-改成自己的站点)                           | 1 小时   |      |
| 4   | [准备外部账号](#4-准备外部账号)                               | 1–2 小时 |      |
| 5   | [部署到 Vercel](#5-部署到-vercel)                             | 30 分钟  |      |
| 6   | [走一遍上线清单，打开真实收款](#6-走一遍上线清单打开真实收款) | 30 分钟  |      |

### 1. 用模板建仓库

在 GitHub 上点 **Use this template → Create a new repository**，然后克隆到本地，并添加模板为 `upstream`，以后用它合并模板更新（见 [UPGRADING.md](UPGRADING.md)）：

```bash
git clone https://github.com/<you>/<project>.git && cd <project>
git remote add upstream https://github.com/linonward/sass.git
```

### 2. 本地跑起来

需要 Node 24（`.nvmrc`）、pnpm（版本见 `package.json` 的 `packageManager`）和 Docker。

```bash
docker run -d --name <project>-postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:18
cp .env.example .env.local
# 编辑 .env.local：DATABASE_URL 用上面的地址，BETTER_AUTH_SECRET 填 `openssl rand -base64 32` 的输出
pnpm install
pnpm db:migrate
pnpm dev                 # http://localhost:3000
```

本地不需要任何外部账号：邮件打印在终端（验证码从这里看），支付、限流、上传、AI 没配 key 时各自返回 503 或跳过。打开 `/sign-in` 用任意邮箱登录，能进入 `/dashboard` 就说明跑通了。

### 3. 改成自己的站点

- `site.config.ts`（写错时 `dev` / `build` 直接报出字段名）：
  - `name`、`domain`（不带协议，比如 `acme.com`）、`description`、`brand`（主色、logo）
  - `features`：用不到的模块关掉，对应的环境变量就不再要求
  - `legal`：公司或个人名称、联系邮箱、适用法域、生效日期
  - `landing`、`billing.plans`：首页区块、定价和每个套餐发放的积分
  - `email`：发件人名称和地址（域名要在 Resend 验证）
  - `ai.models`：开启 AI 时的模型和每次调用的积分成本
- `messages/en.json`：页面文案；`content/legal/`：法律页正文；`content/blog/`：博客文章；`public/`：logo、Hero 图。
- 示例业务模块 `src/features/example/`（一个扣积分的宣传语生成器）演示了业务代码怎么调用 `runAI`、`deductCredits`，以及怎么在 `dashboard.nav` 里加菜单。看完后删掉：`src/features/example/`、`src/app/[locale]/(app)/example/`、`e2e/example.spec.ts`，以及 `site.config.ts` 里 `dashboard.nav` 的那一项。
- 改完运行 `pnpm test -u`（域名和路由变了，sitemap 快照要更新）和 `pnpm build`。

写业务功能前先看一眼 [UPGRADING.md](UPGRADING.md) 的目录边界：业务代码放 `src/features/`，尽量不改 `src/core/`。

### 4. 准备外部账号

按[上线清单](#上线清单)第 4 节，只准备已开启模块需要的服务：Neon（数据库）、Resend（邮件，配好 SPF / DKIM）、Google OAuth（登录）、Creem（收款，先在测试模式建好产品，把产品 ID 填进 `billing.plans`）；开启 AI、上传时还有 Upstash、R2 和模型服务商。

### 5. 部署到 Vercel

按上线清单第 1–3 节：导入仓库、接入 Neon 集成、绑定域名、填写环境变量。Vercel 构建时会先执行 `pnpm db:migrate`，缺少必需的变量时构建直接失败并列出变量名。开启后台（`features.admin`）时记得填 `ADMIN_EMAILS`。

### 6. 走一遍上线清单，打开真实收款

在线上环境依次确认：

1. 首页、`/pricing`、法律页、`/sitemap.xml`、`/robots.txt` 能打开，证书有效。
2. 用邮箱验证码和 Google 各登录一次，收到欢迎邮件。
3. 在 Creem 测试模式买一次付费套餐：成功页显示完成，`/billing` 里套餐和积分正确，收到付款邮件。
4. 用 `ADMIN_EMAILS` 里的邮箱登录，打开 `/admin` 能看到这笔订单。
5. 一切正常后，在 Creem 切到生产模式：换成生产环境的 API key、webhook secret 和产品 ID，设置 `CREEM_MODE=live`，重新部署。

## 本地开发

需要 Node 24（见 `.nvmrc`）和 pnpm（版本见 `package.json` 的 `packageManager`）。

```bash
pnpm install
pnpm dev              # http://localhost:3000
```

| 命令                                | 作用                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `pnpm lint`                         | ESLint                                                                   |
| `pnpm format` / `pnpm format:check` | Prettier 格式化 / 检查                                                   |
| `pnpm typecheck`                    | 生成路由类型并执行 `tsc`                                                 |
| `pnpm test`                         | Vitest 单测（`src/**/*.test.{ts,tsx}`）                                  |
| `pnpm test:e2e`                     | Playwright e2e（`e2e/`，首次需 `pnpm exec playwright install chromium`） |
| `pnpm build`                        | 生产构建                                                                 |
| `pnpm db:generate`                  | 根据 schema 生成迁移文件（`drizzle/`，需提交）                           |
| `pnpm db:migrate`                   | 对 `DATABASE_URL` 执行迁移                                               |
| `pnpm db:studio`                    | 打开 Drizzle Studio 浏览数据                                             |
| `pnpm email:dev`                    | 预览邮件模板（http://localhost:3030）                                    |

`pnpm install` 同时装好 git 钩子：提交时自动用 ESLint 和 Prettier 处理暂存的文件，并用 commitlint 检查提交信息（Conventional Commits），见 [docs/workflow.md](docs/workflow.md#提交前的检查)。

数据库：`DATABASE_URL` 必填（见 `.env.example`）。本地可以用 Docker 起一个 Postgres，再执行 `pnpm db:migrate`。设置了 `DATABASE_URL_TEST` 时，`pnpm test` 会运行数据库测试；未设置时跳过（CI 中必须设置）。

## 配置

- `site.config.ts`：站点名称、域名、品牌色、语言、功能开关（`features`）。由 `defineConfig()` 校验，写错时 `dev` / `build` 直接失败，并指出出错字段。
  - `brand.primaryColor` 生成 shadcn 主题的 `--primary` 等变量，亮色、暗色共用；按钮、链接悬停色随之变化。
  - `nav.header` / `nav.footer` 决定营销页 Header 导航和 Footer 链接，`key` 对应 `messages/*.json` 中 `Nav` 下的文案。
  - `landing` 决定首页区块及顺序（`sections`）、Hero 图片、特性与 FAQ 条目；`billing.plans` 是定价区块展示的套餐。文案在 `messages/*.json` 的 `Landing` 下。
- 收款核心（`src/core/billing/`）：`PaymentProvider` 接口屏蔽具体服务商；webhook 路由调用 `processWebhook(provider, request)`，由 `handleBillingEvent` 在一个事务里完成幂等检查、更新 `subscriptions` / `orders`、触发 `onBillingEvent` 钩子。`billing.plans` 的交易字段：`providerProductId`（付费套餐必填、免费套餐不填）、`credits`（每次购买或每个计费周期发放的积分），`type` 按 `interval` 推导。钩子在 `src/core/billing/hooks.ts` 汇总注册。
- 购买流程：落地页的定价区块和 `/pricing` 共用购买按钮，未登录时先登录，登录后回到 `/pricing?plan=<id>` 自动继续结账；已订阅显示"管理订阅"（客户门户）。结账回跳 `/billing/success`，按回跳附带的订阅或订单 ID 轮询 `/api/billing/status`，webhook 未到时显示"处理中"，超过 `BILLING_SUCCESS_TIMEOUT_MS`（默认 60 秒）提示联系支持。账单页 `/billing` 显示当前套餐、续费日期、积分余额和最近 20 条流水。
- e2e 用 `BILLING_PROVIDER=fake`：结账页和 webhook 由站内的测试路由（`/api/billing/fake/*`、`/api/webhooks/fake`）模拟，可设置 webhook 延迟或不发送。fake 是测试替身，生产运行时（`next build` / `next start` / Docker）、Vercel 上（任何环境）和 `CREEM_MODE=live` 时设成 `fake` 会启动失败，fake 路由在非 fake 模式下返回 404；CI 的 e2e 跑在生产构建上，靠 `ALLOW_FAKE_BILLING=1` 显式放行。
- 接口限流（`src/core/ratelimit/`）：`checkRateLimit(policy, { userId, ip })` 按 `site.config.ts` 的 `rateLimit.policies` 做滑动窗口计数，用户和 IP 各计一次，任一超限即拒绝；被拒绝时 `return rateLimitResponse(result)`（超限 429、Redis 不可用 503，都带 `Retry-After`）。IP 用 `getClientIp(request.headers)` 取。本地没配 Upstash 时跳过限流并警告一次；Redis 出错或超时（1 秒）时按 `rateLimit.failMode` 处理：`open`（默认）放行并记录错误，`closed` 返回 503。登录限流由 Better Auth 负责，不走这里。
- 文件上传（`src/core/upload/`，`features.upload`）：浏览器直传 Cloudflare R2。`POST /api/upload/presign`（body `{ mime, size }`，需要登录，走 `upload` 限流）按 `site.config.ts` 的 `upload.allowedMimeTypes` / `maxFileSize` 校验，登记一条 `pending` 的 `files` 记录，返回预签名 PUT 地址（10 分钟有效，签名覆盖 Content-Type 和 Content-Length，类型或大小不同时 R2 返回 403）；上传后 `POST /api/upload/complete`（body `{ fileId }`）用 HeadObject 确认对象存在、大小和类型一致，改为 `uploaded`。对象 key 为 `<userId>/<yyyy-mm>/<uuid>.<ext>`，扩展名由类型决定。`upload.public` 为 false（默认）时通过 1 小时有效的签名 GET 地址访问，`GET /api/upload/files/<id>` 会跳转过去，可以直接用作 `<img src>`；为 true 时用 `R2_PUBLIC_URL` 下的地址。前端用 `uploadFile(file)`（`src/core/upload/client.ts`）；开启后 Dashboard 首页有一个上传示例。删除账户时 `files` 记录随之删除，R2 上的对象和一直是 `pending` 的记录 v1 不清理。
- AI（`src/core/ai/`，`features.ai` 控制）：`site.config.ts` 的 `ai.models` 列出可用模型（`id`、`provider`（`openai` / `anthropic` / `google`）、`model`、`creditCost`，可选 `maxOutputTokens`），`ai.defaultModel` 是默认模型。env 里配了哪家的 key 就启用哪家，没配 key 的模型调用返回 503。服务端调用 `runAI({ userId, ip, modelId, prompt | messages, ... })`：检查登录 → `ai` 策略限流（429）→ 在一个事务里预扣 `creditCost` 并写入 `ai_usage`（余额不足 402）→ 流式调用模型；模型报错时按 `ai_usage.id` 退回积分（流水里是一条 `refund`），成功时记录 token 用量和耗时。返回的 `result` 是 AI SDK 的 `streamText` 结果；路由里用 `after(() => run.settled)` 保证响应结束后记账跑完。示例接口 `POST /api/ai/chat`（useChat 的 UI message 流，请求体上限 64 KB），示例页 `/playground`。v1 按次固定扣费，不存对话历史。开启收费模型（`creditCost > 0`）需要同时开启 `features.credits`。
- 法律页：`/privacy`、`/terms`、`/refund`，正文模板在 `content/legal/`（归业务方所有），主体信息取自 `site.config.ts` 的 `legal`。**模板仅供参考，不构成法律意见**，上线前请结合业务和适用法律自行审阅，必要时咨询律师。
- 博客（`src/core/blog/`，`features.blog`）：文章是 `content/blog/<locale>/<slug>.mdx`，由 content-collections 在 `dev` / `build` 时编译（配置和 frontmatter schema 在 `content-collections.ts`）。frontmatter：`title`、`description`、`date`（`2026-01-31`）、`tags`（小写 kebab-case）、`cover`（`public/` 下的图片，可选）、`draft`（可选）。页面：`/blog`（每页 12 篇，第 2 页起是 `/blog/page/<n>`）、`/blog/<slug>`、`/blog/tags/<tag>`；RSS 在 `/blog/rss.xml`（其他语言 `/<locale>/blog/rss.xml`）。文章自动进入 sitemap，文章页带 `BlogPosting` JSON-LD 和生成的分享图（`/blog/<slug>/og`）。
  - `draft: true` 的文章只在 `pnpm dev` 里可见，生产构建里访问返回 404，也不进 sitemap 和 RSS。
  - 各语言的文章相互独立，同名文件视为同一篇的翻译（hreflang 只列出有翻译的语言）；没有文章的语言，列表页为空且 noindex。
  - frontmatter 必须是合法 YAML，值里有 `: ` 时加引号。写错的文件会让 `build` 失败并指出文件名；`dev` 里只打印错误。
  - 关闭 `features.blog` 时，把 `nav` 里的 Blog 链接一起删掉。
- 后台（`src/core/admin/`，`features.admin`）：`/admin` 下有指标页和用户、订单、订阅三个列表，列表都在服务端分页。不是管理员（包括未登录）访问 `/admin` 下任何页面都返回 404，不跳转登录页（**这是设计，不是 bug**，理由和整套状态码约定见[错误与权限的边界](#错误与权限的边界)）。
  - 角色和封禁由 Better Auth 的 admin 插件提供（插件一直启用，`user` 表多了 `role`、`banned` 等字段）。v1 去掉了模拟登录（impersonate）权限。
  - 首个管理员：把邮箱写进 `ADMIN_EMAILS`，用这个邮箱登录（邮箱已验证）时自动获得 `admin` 角色。只提升不降级，从名单里删掉邮箱不会收回角色。管理员在 dashboard 侧边栏里会看到 Admin 入口。
  - 用户：按邮箱或名称搜索；详情页可以封禁 / 解封（封禁会让用户所有 session 失效，之后无法登录），调整积分（必须填原因，写一条 `adjust` 流水，`actor_id` 记录操作的管理员，同一次提交重复发送只生效一次），并查看该用户的订阅和订单。
  - 订单、订阅：可按状态筛选。
  - 指标（`/admin/metrics`，查询在 `src/core/admin/metrics.ts`）：最近 7 / 30 / 90 天（按 UTC 日期）的新注册、累计和被封禁用户；净收入（订单金额减去已退款，按币种）、付费用户、活跃订阅和 MRR（`active` 订阅按 `site.config.ts` 里的套餐原价折算，年付 ÷ 12）；积分发放、消耗、退款；AI 按类型和模型的调用次数与失败率（失败 ÷ 已结束的调用，进行中的不计）。没有付费套餐时不显示收入，关闭 `features.credits` / `features.ai` 时不显示对应区块。
  - 新增后台页面放在 `src/app/[locale]/(admin)/admin/` 下，页面开头调用 `await requireAdmin()`（`src/core/admin/session.ts`）；Server Action 里用 `getAdminSession()` 再校验一次。layout 和 page 并行渲染，只在 layout 里检查挡不住 page。
- 可观测性（`src/core/observability/`，`features.observability`）：细项在 `site.config.ts` 的 `observability`（`logLevel`、`otel`、`sentry`、`sentryTracesSampleRate`、`analytics`、`speedInsights`）。
  - 日志：`src/core` 里统一用 `logger.info/warn/error(event, fields)`，不直接 `console.error` / `console.warn`（ESLint 会报错）。事件名用 `模块.动作`，例如 `ai.usage`、`billing.webhook`。`logger.error("x.failed", error)` 或 `logger.error("x.failed", { error, userId })` 都可以。
  - 开启后生产环境每条日志是一行 JSON（`level`、`event`、`time`、`traceId`、字段），可以在 Vercel Logs 里按 `event` 或 `traceId` 搜索；开发环境是易读格式。字段名是 `email`、`token`、`password`、`secret`、`apiKey`、`authorization`、`cookie`（或以它们结尾）时替换为 `[redacted]`，用户只记 ID。关闭时和以前一样，只输出 warn 和 error。
  - 追踪：`observability.otel` 开启时 `src/instrumentation.ts` 用 `@vercel/otel` 注册 OpenTelemetry，服务名是 `site.config.ts` 的 `name`。AI 调用（`ai.text` / `ai.image` / `ai.video.*`）、billing webhook（`billing.webhook`）和积分写操作（`credits.<type>`）各有一个 span。业务代码用 `withSpan(name, attributes, fn)`（`src/core/observability/trace.ts`）加自己的 span。
  - 未捕获的请求错误由 `onRequestError` 记一条 `request.error`（带路由和方法，不带 query）。
  - `logger.setErrorReporter(fn)` 是错误上报的挂载点：`logger.error` 会同时调用它。
  - 错误追踪：`observability.sentry` 开启时接入 Sentry（`@sentry/nextjs`）。服务端抛错（`onRequestError`）、浏览器抛错（`error.tsx` / `global-error.tsx` 和全局未捕获错误）、`logger.error` 都会上报，事件名在 tag `event` 里，其余字段（已脱敏）在 extra 里。登录用户只带 ID；cookie、IP、query、请求体、AI 输入输出、数据库参数和堆栈局部变量都不收集（`src/core/observability/sentry.ts`）。关闭时 Sentry SDK 不会打进构建产物。
  - 流量与性能：`observability.analytics` 开启时根布局挂 Vercel Analytics（页面浏览，不用 cookie），`observability.speedInsights` 开启时挂 Speed Insights（Web Vitals）。关闭时页面不加载任何分析脚本。
  - 转化事件（`src/core/observability/events.ts`）：`sign_up`（服务端，新用户创建后）、`checkout_started`（客户端，跳转到支付页之前，带 `plan`）、`purchase`（服务端，billing 的 `checkout.completed` 提交后，带 `plan`；续费不算）。只带套餐 ID，不带邮箱或支付信息。业务在浏览器里用 `track(name, props)`（`src/core/observability/track.ts`），在服务端用 `trackServer(name, props)`（`track-server.ts`）；开关关闭时都是空操作，服务端发送失败只记 warn。
- 多语言：next-intl，文案在 `messages/<locale>.json`。新增语言见 [docs/i18n.md](docs/i18n.md)。
- SEO：页面 metadata 用 `buildMetadata()`（`src/core/seo/metadata.ts`）生成 canonical、hreflang、Open Graph 和 Twitter；新增营销页时在 `src/core/seo/routes.ts` 登记，sitemap 会自动收录。站点 URL 取自 `domain`。
- `/llms.txt`：给 AI agent 和答案引擎的站点索引（约定见 [llmstxt.org](https://llmstxt.org)）。内容全部从 `site.config.ts`、`messages/*.json` 和博客文章生成，改配置就会跟着变；公开页面、套餐价格、博客、法律页、sitemap/robots/RSS，以及需要登录的路径各一节。排版在 `src/core/seo/llms.ts`（可单测），内容组装在 `src/app/llms.txt/route.ts`。多语言站点只出一份，固定用默认语言的 URL。
- 邮件：`sendEmail({ to, template, props, locale })`（`src/core/email/`），模板在 `src/core/email/templates/`，文案在 `messages/*.json` 的 `Email` 下，发件人取自 `site.config.ts` 的 `email`。发送方式由 `EMAIL_TRANSPORT` 决定：`resend` 真实发送，`console` 打印到终端（本地默认），`file` 写入 `.tmp/emails/`（CI 和 e2e 使用）。
  - 账单邮件：付款成功、付款失败、订阅取消由 `onBillingEvent` 钩子触发（`src/core/billing/emails.ts`），余额跌破 `credits.lowBalanceThreshold` 时发 `credits-low`（同一用户 24 小时内最多一封）。邮件都在数据库事务提交之后才发送：钩子通过 `afterCommit(fn)` 登记，事务回滚时不会发出；同一笔付款、同一订阅的取消只通知一次（`notification_log` 表去重）。发信失败只记日志，不影响 webhook 和扣减。
  - 生产构建默认使用 `resend`，本地没有 key 时用 `EMAIL_TRANSPORT=console pnpm build`。
- 登录：Better Auth（`src/core/auth/`），Google 登录和邮箱验证码登录，路由 `/sign-in`、`/api/auth/*`。验证码参数在 `site.config.ts` 的 `auth.emailOtp`。
  - 需要登录的页面放在 `src/app/[locale]/(app)/` 下：(app) 的 layout 校验 session，未登录时跳转登录页（307，见[错误与权限的边界](#错误与权限的边界)）。写进 `site.config.ts` 的 `dashboard.nav` 的路径，proxy 还会按 cookie 提前拦截并带上回跳地址（`src/core/auth/routes.ts` 的 `protectedPrefixes`）。
  - 服务端取当前用户：`getSession()`（`src/core/auth/session.ts`）；客户端：`authClient`（`src/core/auth/client.ts`）。
  - auth 相关的表由 `pnpm auth:generate` 生成到 `src/core/db/schema/auth.ts`，再 `pnpm db:generate` 生成迁移。
- 登录后的外框：`src/core/dashboard/`，侧边栏 + 用户菜单（头像、邮箱、切换语言、退出登录）。
  - 业务的菜单项写在 `site.config.ts` 的 `dashboard.nav`（`key`、`href`、`icon`），文案在 `messages/*.json` 的 `Dashboard.nav.<key>`；套件自带 Dashboard 和 Settings 两项。
  - 设置页 `/settings`：修改名称、偏好语言（`user.locale`，给用户发事务邮件时用 `preferredLocale()` 取）、删除账户。
  - 删除账户会先依次执行 `onUserDelete` 钩子（`src/core/account/on-user-delete.ts`），任何一个失败就中止删除；然后删除用户，session、account 由外键级联删除。业务表引用 `user.id` 时设 `onDelete: "cascade"`，或者注册钩子自行清理（在 `src/core/account/hooks.ts` 里 import 注册文件）。
- 积分：`src/core/credits/`，由 `features.credits` 开启（关闭时 API 抛 `CreditsDisabledError`，调用方先判断 `creditsEnabled`）。`user_credits` 存余额，`credit_transactions` 记流水（`amount` 带符号，余额恒等于流水之和）。
  - API：`getBalance`、`grantCredits`、`deductCredits`（余额不足抛 `InsufficientCreditsError`）、`refundCredits`（按扣减的 `source` / `sourceId` 退还，每笔只能退一次）、`adjustCredits`、`listTransactions`。
  - 幂等：同一 `(source, sourceId)` 只生效一次，重复调用返回 `{ status: "duplicate" }`，不抛错。`refund` 是保留的来源名。
  - 写操作都接受 `{ tx }`：传入外部事务时作为它的一部分提交或回滚；余额不足等错误只回滚这一步。
- UI 组件：shadcn/ui（Base UI），生成到 `src/core/ui/`。新增组件用 `pnpm dlx shadcn@latest add <name>`。
- 环境变量：复制 `.env.example` 为 `.env.local` 后填写，由 `src/core/env.ts` 校验。关闭的 feature 不要求对应变量。设置 `SKIP_ENV_VALIDATION=1` 可跳过校验。

CI（`.github/workflows/ci.yml`）按 lint → format → typecheck → test → build → e2e 顺序执行。

## 错误与权限的边界

四条容易被当成 bug 的边界：前两条是刻意的设计，后两个是改一行就可能静默改变状态码的陷阱。依据都写在里面，可以自己验证。

### `forbidden()` / `unauthorized()` 在本模板不可用

`next/navigation` 的 `forbidden()` / `unauthorized()` 在 Next 16 是 experimental，**必须开开关才能用**。本仓库没开：`next.config.ts` 里连 `experimental` 这个键都没有（当前只有 `env`），所以 `experimental.authInterrupts` 是关的。文档 `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/authInterrupts.md` 说得很直接：要「enable the `authInterrupts` option in your `next.config.js` file to use them」。

所以这**不是「少两个文件」**。开关不开时调用它会直接抛错，实现见 `node_modules/next/dist/client/components/forbidden.js`：

```
`forbidden()` is experimental and only allowed to be enabled when
`experimental.authInterrupts` is enabled.
```

（`unauthorized()` 同形，在 `unauthorized.js`；两个错误码分别是 `E488` / `E411`。）关键是它抛的是**普通 Error，不是 403 / 401 的 fallback digest**，所以不会被 HTTP access fallback 接住，而是被最近的 `error.tsx` 接住 —— 你得到的是**一个 500，不是一个 403**，跟「写了就能用」的直觉正好相反。

要用得同时做两件事：

1. `next.config.ts` 开 `experimental.authInterrupts: true`；
2. 建 `forbidden.tsx` / `unauthorized.tsx`，否则渲染的是框架默认的 403 / 401 页。

另外三个约束：

- **不能在 root layout 里调用**。本仓库没有 `src/app/layout.tsx`，root layout 是 `src/app/[locale]/layout.tsx` —— 文档 `.../file-conventions/layout.md` 说「Any layout without a `layout.js` above it is a root layout」，并明确 root layout 可以落在动态段下（`app/[lang]/layout.js`）。
- 它靠**抛异常**工作：要 `await` 到那一层；`try/catch` 会把它吞掉；留在未 await 的 promise 里则什么都不渲染，开发环境只在服务端日志里留一条 `unhandledRejection`。
- 放进 `<Suspense>` 边界里就拿不到真 403 / 401（响应已开始流式，见第 3 条）。

`forbidden.tsx` / `unauthorized.tsx` 在 Next 16.3.6 仍是 experimental（两份 file-conventions 文档的 frontmatter 都是 `version: experimental`）。本模板没有这两个文件：`find src -iname "forbidden*" -o -iname "unauthorized*"` 无输出。

需要权限拒绝时用现成的路子：页面 `notFound()` 或跳登录页，API 返回 JSON 401，Server Action 返回状态对象 —— 见下一条。

### 权限模型的分野是有意的

| 场景             | 现状                                        | 在哪                                                                                         |
| ---------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 页面：不是管理员 | **404**，不跳登录页                         | `requireAdmin()`（`src/core/admin/session.ts`）                                              |
| 页面：未登录     | **307** 跳 `/sign-in`，带 `callbackURL`     | `src/proxy.ts` 按 cookie 先拦一次；`(app)` 的 layout 再用 `getSession()` 校验一次            |
| API：未登录      | **401** + JSON `{ error: "unauthorized" }`  | `src/app/api/billing/checkout/route.ts`、`portal/route.ts`、`status/route.ts`                |
| Server Action    | **返回状态对象**，不抛错                    | `AdminActionState`（`src/core/admin/actions.ts`）：`{ status: "error", error: "forbidden" }` |
| 错方法           | **405**（框架给的，空 body、无 `Allow` 头） | 见下                                                                                         |

**`/admin` 对非管理员返回 404 而不是跳登录页，这是设计，不是 bug。** 后台不想让人知道它存在，所以未登录和已登录的非管理员拿到的是同一种响应。`e2e/admin.spec.ts` 锁着这个行为（两条用例都断言 404 且 URL 不变）。

- **页面要 UX，API 要机器可读，所以两种形态并存是故意的。** 浏览器能从 404 页里拿到品牌化和「回首页」的出路；`curl` 一个接口的人要的是能解析的 JSON，不是一整页 HTML。
- **307 不是随便挑的**：Next 的 `redirect()` 默认就是 307（文档 `.../functions/redirect.md`：「The `redirect()` method uses a `307` by default」，会保留请求方法）。站内跳转统一走 `src/core/i18n/navigation.ts` 的 `redirect`（next-intl 包装）。
- **405 是框架行为，模板没写**：`src/app/api/**` 里 `route.ts` 没导出的方法，由 Next 自动补上 `new Response(null, { status: 405 })`（`node_modules/next/dist/server/route-modules/app-route/helpers/auto-implement-methods.js`）。它是**空 body、没有 `Allow` 头**，不像 `{ error }` 那样可解析；`OPTIONS` 自动实现为 204 + `Allow`，`HEAD` 自动复用 `GET`。全仓库（代码和 e2e）没有任何一处碰过 405 —— 想要 JSON 405 得自己写。
- 顺带说明 404 为什么有两种形态：`src/proxy.ts` 的 matcher 排除了 `api|trpc|_next|_vercel|opengraph-image|monitoring|.*\..*`，所以 `/api/*` 和带点的路径（`/missing.png`）不经 proxy，走的是 `src/app/api/[...rest]/route.ts` 的 JSON 404（用 `X-Robots-Tag` 代替 HTML 里的 `noindex`）和根级 `src/app/not-found.tsx`。更具体的路由优先匹配。

### 陷阱：在 `notFound()` 上方加流式边界，会把真 404 变成 200

**现在全站 404 都是真 404，唯一的原因就是没有任何东西在流式：**

```bash
find src -name "loading.tsx" | wc -l   # 0
grep -rn "Suspense" src/ | wc -l       # 0
```

在 `notFound()` 调用点的**上方**加 `loading.tsx` 或 `<Suspense>`，那条路径的 404 就变成 **200 软 404**：响应头已经发出去了，状态码改不了。文档（`.../file-conventions/loading.md`）：「The response body starts streaming when a Suspense fallback renders (for example, a `loading.tsx`) or when a Server Component suspends under a `Suspense` boundary. Place `notFound()` before those boundaries and before any `await` that may suspend.」之后只剩 Next 注入的 `<meta name="robots" content="noindex">` 兜底，爬虫会把它记成 soft 404。

具体到这个仓库：买家访问 `/does-not-exist` 时渲染的是 `src/app/[locale]/not-found.tsx`。按文档，同段的 `loading.tsx` **会**把 `not-found.tsx` 和 `page.js` 一起包进 `<Suspense>`（「`loading.js` wraps `not-found.js`, `page.js`, and nested `layout.js` files in a `<Suspense>` boundary」）—— 也就是说这个边界一旦建立，那条 404 就在它的下方。

**哪条路径真的会变成 200，取决于那个页面的实现**：先刷出 fallback、或页面先 `await` 到挂起，状态码就锁定在 200；同步渲染、还没等就抛 `notFound()` 的，可能仍是 404。所以别把它当成「加个骨架屏没副作用」—— 文档给的判据就一句：「Place `notFound()` before those boundaries and before any `await` that may suspend.」改完要**逐条实测状态码**，别只看界面渲染对不对。

（本节写的是机制，没有逐条实测本仓库加 `loading.tsx` 之后的状态码 —— 那要起服务跑一遍。）

「体验更好」和「真 404」在这里是有代价的：流式一旦开始，状态码就锁死。想两者都要，就得让 `notFound()` 在流式开始前跑完（文档给的办法是把存在性检查挪进 `proxy`）。真要加 instant loading，先掂量代价。

### `loading.tsx` 在 `(app)` / `(admin)` 里不会生效

`(app)` / `(admin)` 的 layout 都要读请求数据：`(app)` 的 layout 调 `getSession()`，`(admin)` 的调 `requireAdmin()`，两者最终都落到 `src/core/auth/session.ts` 里的 `auth.api.getSession({ headers: await headers() })`。文档（`.../file-conventions/loading.md`）：「If the layout accesses uncached or runtime data (e.g. `cookies()`, `headers()`, or uncached fetches), `loading.js` will not show a fallback for it.」没有 Cache Components 时「Navigation blocks until the layout finishes rendering」。

本模板没开 Cache Components（`next.config.ts` 里没有 `experimental` 键），所以 `src/app/[locale]/(app)/loading.tsx` 不会显示骨架屏 —— 导航会一直等到 layout 渲染完，加了等于没加。

想加 instant loading，按文档做两件事之一：**把取数从 layout 下移到 page**（`loading.tsx` 包的是 page），或把 layout 里读请求数据的那部分**单独**包一个 `<Suspense>`。**但先回头看上一条**：`<Suspense>` 会开始流式，会连带改变该路径 404 的状态码。

## 上线清单

### 1. Vercel

- 在 Vercel 导入 GitHub 仓库。仓库根目录的 `vercel.json` 已把 Framework 设为 Next.js，其他保持默认；Node 版本取自 `package.json` 的 `engines`（24.x），pnpm 版本取自 `packageManager`。
- 导入后，只有 `main` 自动部署到生产环境：`vercel.json` 的 `git.deploymentEnabled` 关掉了其他分支和 PR 的自动预览部署，省 Hobby 套餐的部署额度（每天有上限，超了要等 24 小时）。需要预览时在本地运行 `vercel deploy` 手动部署一次；想恢复每个 PR 自动预览，删掉 `git.deploymentEnabled` 即可。下文关于预览部署的说明在手动或恢复自动预览时适用。
- `vercel.json` 的 `ignoreCommand`：自上次部署以来只改了 `docs/` 或 `*.md` 时跳过构建，节省部署次数（Hobby 套餐每天 100 次，账号内所有项目共用）。
- 如果导入时找不到仓库：到 GitHub → Settings → Applications → Vercel → Configure，在 Repository access 里加上这个仓库。

### 2. 域名与 DNS

- Vercel 项目 → Settings → Domains 添加生产域名（与 `site.config.ts` 的 `domain` 保持一致）。
- 在 DNS 服务商处添加 Vercel 给出的记录：
  - 子域名：`CNAME` 指向 Vercel 提供的目标（形如 `xxxx.vercel-dns-017.com`）
  - 根域名：`A` 记录指向 Vercel 提供的 IP
  - 如果域名已被其他 Vercel 账号使用过，还要按提示添加 `_vercel` 的 `TXT` 验证记录
- 使用 Cloudflare 时，这些记录要设为 **DNS only**（灰色云朵）。开启代理会干扰 Vercel 签发证书。
- 验证通过后，Vercel 会自动签发 HTTPS 证书。用浏览器访问 `https://<domain>`，确认证书有效、`/sitemap.xml` 和 `/robots.txt` 能打开。

### 3. 环境变量

在 Vercel 项目 → Settings → Environment Variables 中按环境（Production / Preview）填写。变量清单以 `src/core/env.ts` 为准，缺少必需变量时构建会直接失败。

| 变量                                                                                        | 说明                                                                                                                                 |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                                                              | Postgres 连接地址。Production 和各个预览部署由 Neon 的 Vercel 集成自动注入（见下文）。                                               |
| `RESEND_API_KEY`                                                                            | Resend API key（`re_` 开头）。Production 和 Preview 都要填：Vercel 上两者都是生产构建。                                              |
| `EMAIL_TRANSPORT`                                                                           | 通常不填，生产环境默认 `resend`。只有想让某个环境不真实发信时才设为 `console` 或 `file`。                                            |
| `BETTER_AUTH_SECRET`                                                                        | 必填，Production 和 Preview 都要填（`openssl rand -base64 32`）。两个环境用不同的值。                                                |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`                                                 | Production 必填（见下文"登录（Google）"）。预览部署不提供 Google 登录，Preview 可以不填。                                            |
| `BETTER_AUTH_URL`                                                                           | 通常不填：生产环境自动取 `site.config.ts` 的 `domain`，预览取本次部署的地址。                                                        |
| `CREEM_API_KEY` / `CREEM_WEBHOOK_SECRET`                                                    | 有付费套餐时 Production 必填（见下文"支付（Creem）"）。Preview 可以不填，此时结账返回 503。                                          |
| `CREEM_MODE`                                                                                | `test`（默认）或 `live`。上线真实收款前必须显式设为 `live`。                                                                         |
| `BILLING_PROVIDER`                                                                          | 不填（默认 `creem`）。`fake` 只用于本地和 CI 的 e2e；生产运行时、Vercel 或 `CREEM_MODE=live` 下设置会启动失败。                      |
| `ALLOW_FAKE_BILLING`                                                                        | 可选，默认关闭。设为 `1` / `true` 时放行 fake（CI 的 e2e 需要）；Vercel 和 `CREEM_MODE=live` 下无效。                                |
| `BILLING_SUCCESS_TIMEOUT_MS`                                                                | 可选，成功页等待 webhook 的时长，默认 `60000`。                                                                                      |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`                                       | 开启 `features.ai`、`upload` 或 `rateLimit` 时 Production 必填（见下文"限流（Upstash）"）。Preview 不填时跳过限流。                  |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET`                 | 开启 `features.upload` 时 Production 必填（见下文"文件上传（Cloudflare R2）"）。Preview 不填时上传接口返回 503。                     |
| `R2_PUBLIC_URL`                                                                             | bucket 的公开域名（`https://files.example.com`），只在 `upload.public` 为 true 时需要。                                              |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` / `ALIBABA_API_KEY` | 开启 `features.ai` 时，Production 必须填上 `ai.models` 用到的每家服务商的 key（见下文"AI 服务商"）。Preview 不填时对应模型返回 503。 |
| `ADMIN_EMAILS`                                                                              | 开启 `features.admin` 时 Production 必填：逗号分隔的邮箱，用这些邮箱登录即成为管理员（见"配置"里的后台）。Preview 可以不填。         |
| `ALIBABA_BASE_URL`                                                                          | 可选。百炼 key 所在地域的地址，不填是国际站；北京地域填 `https://dashscope.aliyuncs.com/compatible-mode/v1`。                        |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                                                               | 可选。开启 `observability.otel` 且不用 Vercel 的 trace 集成时，trace 导出到这个 OTLP 地址（见下文"日志与追踪"）。                    |
| `NEXT_PUBLIC_SENTRY_DSN`                                                                    | 开启 `observability.sentry` 时必填（Production 和 Preview 都要）：Sentry 项目的 DSN（见下文"错误追踪（Sentry）"）。                  |
| `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT`                                       | 可选。三项都填时构建会上传 source map，Sentry 里的堆栈显示源码位置；上传后从产物里删掉。                                             |

### 4. 按已开启的模块准备外部账号

| 模块                                   | 外部服务                    | 什么时候需要             |
| -------------------------------------- | --------------------------- | ------------------------ |
| 数据库                                 | Neon Postgres               | 登录功能上线时（阶段 2） |
| 邮件                                   | Resend（并配置 SPF / DKIM） | 登录功能上线时（阶段 2） |
| 登录                                   | Google Cloud OAuth 客户端   | 登录功能上线时（阶段 2） |
| 支付                                   | Creem                       | 开始收款时（阶段 3）     |
| `features.rateLimit` / `ai` / `upload` | Upstash Redis               | 生产环境开启任一模块时   |
| `features.ai`                          | AI 模型服务商               | 开启 AI 时               |
| `features.upload`                      | Cloudflare R2               | 开启上传时               |
| `features.admin`                       | 无（只需 `ADMIN_EMAILS`）   | 开启后台时               |
| `observability.sentry`                 | Sentry                      | 开启错误追踪时           |

具体变量名由对应模块的任务补充到本节。

#### 数据库（Neon）

1. 在 Neon 创建项目，默认分支作为生产库。
2. Vercel 项目 → Integrations，从 Marketplace 安装 **Neon**，关联上一步的 Neon 项目，并开启 **Create a branch for each preview deployment**。集成会为 Production 注入主分支的 `DATABASE_URL`，为每个预览部署创建独立的数据库分支并注入对应的 `DATABASE_URL`，预览不会连到生产库。
3. 迁移随部署自动执行：`vercel.json` 的构建命令是 `pnpm db:migrate && pnpm build`，预览部署迁移自己的分支，生产部署迁移主分支。迁移失败时本次部署会失败，线上仍是上一个版本。
   - 迁移会在新代码上线前执行，线上旧代码会短暂面对新表结构。所以迁移应保持向后兼容：先加列或加表，删列放到下一次发布。

#### 邮件（Resend）

1. 在 Resend → Domains 添加发信域名，与 `site.config.ts` 的 `email.fromAddress` 的域名一致（比如 `sass.linonward.com`）。建议用子域名发信，不影响根域名的邮件信誉。
2. 在 DNS 服务商处添加 Resend 给出的记录：
   - SPF：`send` 子域名下的 `MX` 和 `TXT`（具体取值以 Resend 面板给出的为准）
   - DKIM：`resend._domainkey` 的 `TXT`
   - DMARC（建议）：`_dmarc` 的 `TXT`，例如 `v=DMARC1; p=none; rua=mailto:<你的邮箱>`
   - 使用 Cloudflare 时，这些记录都设为 **DNS only**。
3. 等 Resend 显示域名已验证，然后在 API Keys 创建一个只有发送权限（Sending access）的 key，填到 Vercel 的 `RESEND_API_KEY`。
4. 部署后触发一次真实发信（比如登录验证码），确认邮件进了收件箱而不是垃圾箱。

#### 登录（Google）

1. Google Cloud Console → APIs & Services：
   - OAuth consent screen：填写应用名称、支持邮箱、`site.config.ts` 的域名和隐私政策 / 服务条款地址（`https://<domain>/privacy`、`/terms`），发布状态设为 In production。
   - Credentials → Create credentials → OAuth client ID，类型选 **Web application**。
     - Authorized JavaScript origins：`https://<domain>`、`http://localhost:3000`
     - Authorized redirect URIs：`https://<domain>/api/auth/callback/google`、`http://localhost:3000/api/auth/callback/google`
2. 把 Client ID 和 Client secret 填到 Vercel Production 的 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`；本地需要测试 Google 登录时填到 `.env.local`。
3. 预览部署的地址每次都不同，无法登记为回调地址，所以预览只提供邮箱验证码登录。以后需要时可以接入 Better Auth 的 `oauth-proxy` 插件。
4. 账户关联：同一邮箱先用验证码注册、再用 Google 登录，会进入同一个账户（`google` 是可信 provider）。

#### 支付（Creem）

1. 在 Creem 后台用左下角的开关切到 **Test Mode**，创建产品：订阅套餐选 recurring（每月或每年，与 `site.config.ts` 的 `interval` 一致），一次性套餐选 one-time。把产品 ID（`prod_...`）填进 `site.config.ts` 对应套餐的 `providerProductId`。占位值 `prod_placeholder_*` 不允许结账。
2. Developers 里拿 API key 和 webhook secret，填到 Vercel Production 的 `CREEM_API_KEY`、`CREEM_WEBHOOK_SECRET`；`CREEM_MODE` 不填（默认 `test`）。
3. Developers → Webhooks 添加地址 `https://<domain>/api/webhooks/creem`。
   - Vercel 的预览部署默认开启 Deployment Protection，外部请求会被拦截，所以 webhook 不能指向预览地址。测试模式的 webhook 也指向生产域名；本地调试用 [Creem CLI](https://docs.creem.io/code/cli) 的本地转发或 ngrok 之类的隧道。
   - 用了 Cloudflare 代理或 WAF 时，给 webhook 路径放行，不要被 Bot Fight Mode 拦住。
4. 测试卡 `4111 1111 1111 1111`（任意未来日期和 CVV）完成一次订阅和一次一次性付款，检查 `subscriptions`、`orders`、`credit_transactions` 表。
5. 切到生产模式（真实收款）：
   - Creem 后台关掉 Test Mode，重新创建同样的产品，把生产模式的产品 ID 换进 `site.config.ts`。
   - 换成生产模式的 `CREEM_API_KEY` 和 `CREEM_WEBHOOK_SECRET`，并把 `CREEM_MODE` 设为 `live`。
   - 在生产模式的 Developers → Webhooks 重新添加同一个 webhook 地址。
6. 删除账户时会先在 Creem 取消该用户仍在计费的订阅；取消失败时删除中止。退款只更新订单状态，v1 不扣回已发的积分。
7. 自托管（Docker / `next start`，没有 `VERCEL_ENV`）时同样的闸门按 `NODE_ENV` 生效：生产运行时把 `BILLING_PROVIDER` 设成 `fake` 会启动失败，fake 的结账页、客户门户和 webhook 路由也一律 404。只有显式设 `ALLOW_FAKE_BILLING=1` 才放行，它只用于本地/CI 的 e2e 或明确的模拟支付环境 —— 开了之后任何人都能走假结账免费拿到套餐和积分，别在对外环境开。

#### AI 服务商

1. 在用到的服务商后台创建 API key：[OpenAI](https://platform.openai.com/api-keys)、[Anthropic](https://console.anthropic.com/settings/keys)、[Google AI Studio](https://aistudio.google.com/apikey)、[阿里云百炼](https://bailian.console.aliyun.com/?tab=model#/api-key)，并设置用量上限。
2. 填到 Vercel Production 的 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`GOOGLE_GENERATIVE_AI_API_KEY`、`ALIBABA_API_KEY`（只填 `ai.models` 用到的）。
   - 百炼（`provider: "alibaba"`）除了 Qwen，还能调百炼上托管的 DeepSeek、Kimi 等模型，`model` 填百炼的模型名（如 `deepseek-v4-flash`）。
   - 百炼的 key 分地域，默认地址是国际站（新加坡）。北京地域的 key 要把 `ALIBABA_BASE_URL` 设为 `https://dashscope.aliyuncs.com/compatible-mode/v1`，否则返回 401。
3. 按模型的实际成本调整 `creditCost` 和 `maxOutputTokens`：按次固定扣费，`maxOutputTokens` 决定单次调用成本的上限。默认开思考的模型（如百炼上的 `deepseek-v4-*`）可以设 `reasoning: "none"` 关掉思考，省下思考的 token。
4. 上线后在 `/playground` 调用一次，检查 `ai_usage` 有记录、积分流水里有对应的扣减。
5. 图片生成（`ai.imageModels`）：还需要开启 `features.upload` 并配好 R2，生成的图片存进 bucket，`files` 和 `ai_usage`（`kind = image`）各有一条记录。百炼的 `qwen-image-*` 每张约 7 秒，`wan*-image*` 约 30 秒，接口同步返回，`/api/ai/image` 的 `maxDuration` 是 120 秒。在 `/playground` 的「Image」标签页生成一张，确认图片能打开、最近生成里能看到。
6. 视频生成（`ai.videoModels`）：同样需要 `features.upload` 和 R2。`input: "text"` 是文生视频，`"image"` 是图生视频（首帧用用户自己的图片，百炼通过公开地址或签名地址读取）。时长和分辨率写在配置里，按次扣费。任务是异步的：前端每 5 秒查询一次 `GET /api/ai/video/:id`，查询时完成的视频转存 R2，失败的退款；提交后 30 分钟仍未完成按失败退款。没有后台任务扫描，用户离开后再回到 Playground 时才会结算。

#### 限流（Upstash）

1. 在 [Upstash](https://console.upstash.com) 创建一个 Redis 数据库，区域选离 Vercel 函数最近的（默认 `iad1` 对应 US East）。
2. 把 REST API 的 URL 和 token 填到 Vercel Production 的 `UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN`；也可以从 Vercel Marketplace 安装 Upstash 集成自动注入（变量名相同）。
3. 阈值在 `site.config.ts` 的 `rateLimit.policies` 调整，默认 `ai` 每分钟 20 次、`upload` 每分钟 10 次。

#### 文件上传（Cloudflare R2）

1. Cloudflare 后台 → R2 创建 bucket（生产和预览可以分开建）。`R2_ACCOUNT_ID` 是 R2 概览页右侧的 Account ID（32 位十六进制）。
2. R2 → Manage API tokens 创建一个 **Object Read & Write** 权限、只作用于这个 bucket 的 token，把 Access Key ID 和 Secret Access Key 填到 `R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`，bucket 名填到 `R2_BUCKET`。
3. 浏览器直传需要 CORS。bucket → Settings → CORS Policy 填入（把域名换成自己的；本地调试再加 `http://localhost:3000`）：

   ```json
   [
     {
       "AllowedOrigins": ["https://<domain>"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

4. 公开访问（`upload.public: true`）：bucket → Settings → Custom Domains 绑定一个子域名（例如 `files.<domain>`），填到 `R2_PUBLIC_URL`。不要用 `r2.dev` 地址上线，它有限速。私有文件（默认）不需要这一步。
5. 开启 `features.upload` 后登录 Dashboard，用首页的上传示例传一个文件，检查 `files` 表里的状态变成 `uploaded`，并能打开文件链接。

#### 日志与追踪（可选）

1. `site.config.ts` 里开启 `features.observability`，按需把 `observability.logLevel` 调成 `debug`。部署后在 Vercel → Logs 里搜 `"event":"ai.usage"`、`"event":"billing.webhook"`，或者按某条日志的 `traceId` 找到同一个请求的所有日志。
2. 需要 trace 时再开启 `observability.otel`：
   - 在 Vercel 上：项目 → Observability 里开启 Tracing，或者在 Integrations 里接入 Datadog、Honeycomb 等 OTel 集成，不需要额外的变量。
   - 其他后端：填 `OTEL_EXPORTER_OTLP_ENDPOINT`（需要鉴权时加 `OTEL_EXPORTER_OTLP_HEADERS`，例如 `x-honeycomb-team=<key>`）。两者都没有时不导出 trace，日志照常输出。

#### 错误追踪（Sentry，可选）

1. 在 Sentry 新建一个 Next.js 项目，复制 DSN，在 Vercel 的 Production 和 Preview 都填上 `NEXT_PUBLIC_SENTRY_DSN`。
2. `site.config.ts` 里开启 `features.observability` 和 `observability.sentry`。性能追踪按 `observability.sentryTracesSampleRate` 采样（默认 `0.1`）；同时开了 `otel` 时追踪交给 OpenTelemetry，Sentry 只收错误，并关联到同一个 trace。
3. 可选：在 Sentry → Settings → Auth Tokens 创建 Organization Token，连同组织和项目的 slug 填进 `SENTRY_AUTH_TOKEN`、`SENTRY_ORG`、`SENTRY_PROJECT`，构建时会上传 source map。
4. 建议在 Sentry 项目 → Settings → Security & Privacy 里开启 **Prevent Storing of IP Addresses**：SDK 不发 IP，但 Sentry 默认会记录上报请求的来源 IP。
5. 浏览器事件经本站的 `/monitoring` 转发给 Sentry，减少被广告拦截插件拦掉。这个路径不要再用作页面（`src/proxy.ts` 的 matcher 跳过了它）。
6. 部署后在浏览器控制台执行 `setTimeout(() => { throw new Error("sentry test") })`，几秒后 Sentry 的 Issues 里应能看到这条错误，带 release 和登录用户的 ID。

#### 流量与性能（可选）

1. Vercel 项目 → Analytics 里点 Enable；需要页面性能时在 Speed Insights 里也点 Enable。不需要额外的变量。
2. `site.config.ts` 里开启 `features.observability`，再开启 `observability.analytics` / `observability.speedInsights`，重新部署。
3. 自定义事件（`sign_up`、`checkout_started`、`purchase`）需要 Pro 或 Enterprise 计划，Hobby 只统计页面浏览。开启了 Deployment Protection 的预览环境，服务端事件需要在项目里创建 Protection Bypass for Automation（`VERCEL_AUTOMATION_BYPASS_SECRET`）。
4. `purchase` 由 webhook 触发，没有访客上下文，所以在 Analytics 里看不到它的来源和设备；按 `plan` 筛选即可。

### 5. GitHub

- `main` 开启分支保护：必须通过 PR 合入，`ci` 为必需检查，禁止 force push。详见 [docs/workflow.md](docs/workflow.md#github-仓库设置)。

### 6. 可用性监控

- 站点可用性可以用外部服务盯着，比如 UptimeRobot 或 Better Stack 的免费版：监控 `https://<domain>`，间隔 5 分钟（Better Stack 免费版是 3 分钟），告警走邮件。注意免费版都不提供证书到期告警。
- 证书到期由仓库自带的 `tls-expiry` 工作流兜底：每天 01:00 UTC 跑一次 `scripts/check-tls-expiry.mjs`，检查 `site.config.ts` 里 `domain` 的证书剩余有效期，不足 30 天就开一条 issue，并让这次运行失败（GitHub 会发失败通知）。本地也可以随时手动跑：

  ```bash
  node scripts/check-tls-expiry.mjs --days 14
  node scripts/check-tls-expiry.mjs --hosts a.example.com,b.example.com
  ```

  Vercel 托管的证书是自动续期的，所以这条检查主要是发现"续期卡住了"这种静默失败。
