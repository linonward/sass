# sass

可复用的出海 SaaS 模板：改配置即可得到登录、支付（Creem）、积分、AI、多语言、SEO 等基础设施，只需编写业务功能。

当前处于搭建阶段，进度见任务表。

- 方案：[docs/plan.md](docs/plan.md)
- 任务路径：[docs/tasks/README.md](docs/tasks/README.md)
- 开发流程：[docs/workflow.md](docs/workflow.md)

## 快速开始

1. 在 GitHub 上点 **Use this template** 创建新仓库，然后克隆到本地。
2. 修改 `site.config.ts`：
   - `name`、`domain`（不带协议，比如 `acme.com`）、`description`
   - `brand`：主色和 logo
   - `legal`：公司或个人名称、联系邮箱、适用法域、生效日期
   - `landing`、`billing.plans`：首页区块和定价展示
3. 修改 `messages/en.json` 里的文案，替换 `public/` 下的 logo 和 Hero 图。
4. 本地运行：

   ```bash
   pnpm install
   pnpm dev          # http://localhost:3000
   pnpm test -u      # 改了 domain 或路由后，更新 sitemap 快照
   ```

5. 按下面的[上线清单](#上线清单)部署。

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

数据库：`DATABASE_URL` 必填（见 `.env.example`）。本地可以用 Docker 起一个 Postgres，再执行 `pnpm db:migrate`。设置了 `DATABASE_URL_TEST` 时，`pnpm test` 会运行数据库测试；未设置时跳过（CI 中必须设置）。

## 配置

- `site.config.ts`：站点名称、域名、品牌色、语言、功能开关（`features`）。由 `defineConfig()` 校验，写错时 `dev` / `build` 直接失败，并指出出错字段。
  - `brand.primaryColor` 生成 shadcn 主题的 `--primary` 等变量，亮色、暗色共用；按钮、链接悬停色随之变化。
  - `nav.header` / `nav.footer` 决定营销页 Header 导航和 Footer 链接，`key` 对应 `messages/*.json` 中 `Nav` 下的文案。
  - `landing` 决定首页区块及顺序（`sections`）、Hero 图片、特性与 FAQ 条目；`billing.plans` 是定价区块展示的套餐。文案在 `messages/*.json` 的 `Landing` 下。
- 收款核心（`src/core/billing/`）：`PaymentProvider` 接口屏蔽具体服务商；webhook 路由调用 `processWebhook(provider, request)`，由 `handleBillingEvent` 在一个事务里完成幂等检查、更新 `subscriptions` / `orders`、触发 `onBillingEvent` 钩子。`billing.plans` 的交易字段：`providerProductId`（付费套餐必填、免费套餐不填）、`credits`（每次购买或每个计费周期发放的积分），`type` 按 `interval` 推导。钩子在 `src/core/billing/hooks.ts` 汇总注册。
- 购买流程：落地页的定价区块和 `/pricing` 共用购买按钮，未登录时先登录，登录后回到 `/pricing?plan=<id>` 自动继续结账；已订阅显示"管理订阅"（客户门户）。结账回跳 `/billing/success`，按回跳附带的订阅或订单 ID 轮询 `/api/billing/status`，webhook 未到时显示"处理中"，超过 `BILLING_SUCCESS_TIMEOUT_MS`（默认 60 秒）提示联系支持。账单页 `/billing` 显示当前套餐、续费日期、积分余额和最近 20 条流水。
- e2e 用 `BILLING_PROVIDER=fake`：结账页和 webhook 由站内的测试路由（`/api/billing/fake/*`、`/api/webhooks/fake`）模拟，可设置 webhook 延迟或不发送。Vercel 上（任何环境）或 `CREEM_MODE=live` 时设成 `fake` 会启动失败，fake 路由在非 fake 模式下返回 404。
- 接口限流（`src/core/ratelimit/`）：`checkRateLimit(policy, { userId, ip })` 按 `site.config.ts` 的 `rateLimit.policies` 做滑动窗口计数，用户和 IP 各计一次，任一超限即拒绝；被拒绝时 `return rateLimitResponse(result)`（超限 429、Redis 不可用 503，都带 `Retry-After`）。IP 用 `getClientIp(request.headers)` 取。本地没配 Upstash 时跳过限流并警告一次；Redis 出错或超时（1 秒）时按 `rateLimit.failMode` 处理：`open`（默认）放行并记录错误，`closed` 返回 503。登录限流由 Better Auth 负责，不走这里。
- 文件上传（`src/core/upload/`，`features.upload`）：浏览器直传 Cloudflare R2。`POST /api/upload/presign`（body `{ mime, size }`，需要登录，走 `upload` 限流）按 `site.config.ts` 的 `upload.allowedMimeTypes` / `maxFileSize` 校验，登记一条 `pending` 的 `files` 记录，返回预签名 PUT 地址（10 分钟有效，签名覆盖 Content-Type 和 Content-Length，类型或大小不同时 R2 返回 403）；上传后 `POST /api/upload/complete`（body `{ fileId }`）用 HeadObject 确认对象存在、大小和类型一致，改为 `uploaded`。对象 key 为 `<userId>/<yyyy-mm>/<uuid>.<ext>`，扩展名由类型决定。`upload.public` 为 false（默认）时通过 1 小时有效的签名 GET 地址访问，`GET /api/upload/files/<id>` 会跳转过去，可以直接用作 `<img src>`；为 true 时用 `R2_PUBLIC_URL` 下的地址。前端用 `uploadFile(file)`（`src/core/upload/client.ts`）；开启后 Dashboard 首页有一个上传示例。删除账户时 `files` 记录随之删除，R2 上的对象和一直是 `pending` 的记录 v1 不清理。
- 法律页：`/privacy`、`/terms`、`/refund`，正文模板在 `content/legal/`（归业务方所有），主体信息取自 `site.config.ts` 的 `legal`。**模板仅供参考，不构成法律意见**，上线前请结合业务和适用法律自行审阅，必要时咨询律师。
- 多语言：next-intl，文案在 `messages/<locale>.json`。新增语言见 [docs/i18n.md](docs/i18n.md)。
- SEO：页面 metadata 用 `buildMetadata()`（`src/core/seo/metadata.ts`）生成 canonical、hreflang、Open Graph 和 Twitter；新增营销页时在 `src/core/seo/routes.ts` 登记，sitemap 会自动收录。站点 URL 取自 `domain`。
- 邮件：`sendEmail({ to, template, props, locale })`（`src/core/email/`），模板在 `src/core/email/templates/`，文案在 `messages/*.json` 的 `Email` 下，发件人取自 `site.config.ts` 的 `email`。发送方式由 `EMAIL_TRANSPORT` 决定：`resend` 真实发送，`console` 打印到终端（本地默认），`file` 写入 `.tmp/emails/`（CI 和 e2e 使用）。
  - 账单邮件：付款成功、付款失败、订阅取消由 `onBillingEvent` 钩子触发（`src/core/billing/emails.ts`），余额跌破 `credits.lowBalanceThreshold` 时发 `credits-low`（同一用户 24 小时内最多一封）。邮件都在数据库事务提交之后才发送：钩子通过 `afterCommit(fn)` 登记，事务回滚时不会发出；同一笔付款、同一订阅的取消只通知一次（`notification_log` 表去重）。发信失败只记日志，不影响 webhook 和扣减。
  - 生产构建默认使用 `resend`，本地没有 key 时用 `EMAIL_TRANSPORT=console pnpm build`。
- 登录：Better Auth（`src/core/auth/`），Google 登录和邮箱验证码登录，路由 `/sign-in`、`/api/auth/*`。验证码参数在 `site.config.ts` 的 `auth.emailOtp`。
  - 需要登录的页面放在 `src/app/[locale]/(app)/` 下，并在 `src/core/auth/routes.ts` 的 `protectedPrefixes` 登记：proxy 按 cookie 快速拦截，(app) 的 layout 再校验 session。
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

## 上线清单

### 1. Vercel

- 在 Vercel 导入 GitHub 仓库。仓库根目录的 `vercel.json` 已把 Framework 设为 Next.js，其他保持默认；Node 版本取自 `package.json` 的 `engines`（24.x），pnpm 版本取自 `packageManager`。
- 导入后，`main` 自动部署到生产环境，每个 PR 自动生成预览部署。
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

| 变量                                                                        | 说明                                                                                                                |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                              | Postgres 连接地址。Production 和各个预览部署由 Neon 的 Vercel 集成自动注入（见下文）。                              |
| `RESEND_API_KEY`                                                            | Resend API key（`re_` 开头）。Production 和 Preview 都要填：Vercel 上两者都是生产构建。                             |
| `EMAIL_TRANSPORT`                                                           | 通常不填，生产环境默认 `resend`。只有想让某个环境不真实发信时才设为 `console` 或 `file`。                           |
| `BETTER_AUTH_SECRET`                                                        | 必填，Production 和 Preview 都要填（`openssl rand -base64 32`）。两个环境用不同的值。                               |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`                                 | Production 必填（见下文"登录（Google）"）。预览部署不提供 Google 登录，Preview 可以不填。                           |
| `BETTER_AUTH_URL`                                                           | 通常不填：生产环境自动取 `site.config.ts` 的 `domain`，预览取本次部署的地址。                                       |
| `CREEM_API_KEY` / `CREEM_WEBHOOK_SECRET`                                    | 有付费套餐时 Production 必填（见下文"支付（Creem）"）。Preview 可以不填，此时结账返回 503。                         |
| `CREEM_MODE`                                                                | `test`（默认）或 `live`。上线真实收款前必须显式设为 `live`。                                                        |
| `BILLING_PROVIDER`                                                          | 不填（默认 `creem`）。`fake` 只用于本地和 CI 的 e2e，Vercel 上设置会启动失败。                                      |
| `BILLING_SUCCESS_TIMEOUT_MS`                                                | 可选，成功页等待 webhook 的时长，默认 `60000`。                                                                     |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`                       | 开启 `features.ai`、`upload` 或 `rateLimit` 时 Production 必填（见下文"限流（Upstash）"）。Preview 不填时跳过限流。 |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | 开启 `features.upload` 时 Production 必填（见下文"文件上传（Cloudflare R2）"）。Preview 不填时上传接口返回 503。    |
| `R2_PUBLIC_URL`                                                             | bucket 的公开域名（`https://files.example.com`），只在 `upload.public` 为 true 时需要。                             |

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

### 5. GitHub

- `main` 开启分支保护：必须通过 PR 合入，`ci` 为必需检查，禁止 force push。详见 [docs/workflow.md](docs/workflow.md#github-仓库设置)。
