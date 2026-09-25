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

## 配置

- `site.config.ts`：站点名称、域名、品牌色、语言、功能开关（`features`）。由 `defineConfig()` 校验，写错时 `dev` / `build` 直接失败，并指出出错字段。
  - `brand.primaryColor` 生成 shadcn 主题的 `--primary` 等变量，亮色、暗色共用；按钮、链接悬停色随之变化。
  - `nav.header` / `nav.footer` 决定营销页 Header 导航和 Footer 链接，`key` 对应 `messages/*.json` 中 `Nav` 下的文案。
  - `landing` 决定首页区块及顺序（`sections`）、Hero 图片、特性与 FAQ 条目；`billing.plans` 是定价区块展示的套餐。文案在 `messages/*.json` 的 `Landing` 下。
- 法律页：`/privacy`、`/terms`、`/refund`，正文模板在 `content/legal/`（归业务方所有），主体信息取自 `site.config.ts` 的 `legal`。**模板仅供参考，不构成法律意见**，上线前请结合业务和适用法律自行审阅，必要时咨询律师。
- 多语言：next-intl，文案在 `messages/<locale>.json`。新增语言见 [docs/i18n.md](docs/i18n.md)。
- SEO：页面 metadata 用 `buildMetadata()`（`src/core/seo/metadata.ts`）生成 canonical、hreflang、Open Graph 和 Twitter；新增营销页时在 `src/core/seo/routes.ts` 登记，sitemap 会自动收录。站点 URL 取自 `domain`。
- UI 组件：shadcn/ui（Base UI），生成到 `src/core/ui/`。新增组件用 `pnpm dlx shadcn@latest add <name>`。
- 环境变量：复制 `.env.example` 为 `.env.local` 后填写，由 `src/core/env.ts` 校验。关闭的 feature 不要求对应变量。设置 `SKIP_ENV_VALIDATION=1` 可跳过校验。

CI（`.github/workflows/ci.yml`）按 lint → format → typecheck → test → build → e2e 顺序执行。

## 上线清单

### 1. Vercel

- 在 Vercel 导入 GitHub 仓库。仓库根目录的 `vercel.json` 已把 Framework 设为 Next.js，其他保持默认；Node 版本取自 `package.json` 的 `engines`（24.x），pnpm 版本取自 `packageManager`。
- 导入后，`main` 自动部署到生产环境，每个 PR 自动生成预览部署。
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

在 Vercel 项目 → Settings → Environment Variables 中按环境（Production / Preview）填写。变量清单以 `src/core/env.ts` 为准，缺少必需变量时构建会直接失败。当前阶段不需要任何变量。

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

### 5. GitHub

- `main` 开启分支保护：必须通过 PR 合入，`ci` 为必需检查，禁止 force push。详见 [docs/workflow.md](docs/workflow.md#github-仓库设置)。
