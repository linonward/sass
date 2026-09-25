# 阶段 1：落地站

阶段完成后：可以上线落地页或 waitlist 站。

---

## T101 scaffold

- 分支 / worktree：`chore/scaffold` → `../sass-scaffold`
- 依赖：T001

**做**

- 用 `create-next-app` 初始化：App Router、TypeScript strict、`src/` 目录、Tailwind、pnpm
- 采用 create-next-app 默认的 ESLint 配置，加 Prettier
- `.nvmrc` 固定 Node 当前 LTS；`package.json` 声明 `packageManager`
- 接入 Vitest（单测）和 Playwright（e2e），各放一个示例测试
- GitHub Actions 工作流 `ci`：install → lint → typecheck → test → build
- `.gitignore`、`.env.example`（先留空结构）

**不做**：UI 组件库、配置系统、任何业务页面

**验收**

- [ ] `pnpm dev` 能打开占位首页
- [ ] `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过
- [ ] PR 上的 `ci` 检查为绿色

**测试**：示例单测和示例 e2e（访问首页，断言返回 200）

---

## T102 config

- 分支 / worktree：`feat/config` → `../sass-config`
- 依赖：T101

**做**

- `src/core/config/schema.ts`：用 zod 定义配置 schema，包含 `name`、`domain`、`description`、`brand`（主色、logo 路径）、`locales`、`defaultLocale`、`features`（`credits` / `ai` / `blog` / `upload` / `admin` / `rateLimit`）
- 根目录 `site.config.ts`：业务方填写的实例，由 `defineConfig()` 做校验
- `src/core/env.ts`：用 `@t3-oss/env-nextjs` 校验环境变量，根据 `features` 动态组装 schema，关闭的模块不要求对应的 key
- 后续任务在各自的 PR 里向 schema 添加自己的字段，不在本任务里预先占位

**不做**：任何具体模块的 env 字段（由对应任务添加）

**验收**

- [ ] 配置写错时，报错信息能指出具体字段
- [ ] 关闭某个 feature 后，不再要求该模块的 env

**测试**：Vitest 覆盖以下情况：schema 合法与非法、feature 开或关时 env 的要求

---

## T103 ui-shell

- 分支 / worktree：`feat/ui-shell` → `../sass-ui-shell`
- 依赖：T102

**做**

- 初始化 shadcn/ui，引入基础组件：button、card、input、label、dialog、dropdown-menu、sheet、sonner、skeleton
- 主题 CSS 变量从 `site.config.ts` 的 `brand` 生成；用 `next-themes` 支持暗色模式
- 营销页布局：Header（导航项来自配置）、Footer（链接来自配置）、移动端菜单
- 404 页和错误页

**不做**：落地页的具体区块、多语言

**验收**

- [ ] 修改 `brand.primary` 后，按钮和链接的颜色跟着变化
- [ ] 暗色模式切换正常，在 375px 宽度下布局不溢出

**测试**：e2e 覆盖 404 页、暗色模式切换

---

## T104 i18n

- 分支 / worktree：`feat/i18n` → `../sass-i18n`
- 依赖：T103

**做**

- 接入 next-intl，路由放在 `src/app/[locale]/`
- `localePrefix: "as-needed"`：默认语言不带前缀，其他语言带前缀（如 `/zh/...`）
- `messages/en.json`；把 Header 和 Footer 的文案迁移过去
- 语言切换器：`locales` 多于 1 个时才显示
- 在 `docs/` 中写明新增一门语言的步骤

**不做**：翻译任何非英文文案

**验收**

- [ ] 在 `locales` 加入 `zh` 并新增 `messages/zh.json` 后，`/zh` 能正常访问，不需要改代码
- [ ] 只有一门语言时，切换器隐藏

**测试**：e2e 使用测试用的第二门语言，验证切换后 URL 和文案都变化

---

## T105 landing

- 分支 / worktree：`feat/landing` → `../sass-landing`
- 依赖：T104

**做**

- 区块组件放在 `src/core/marketing/sections/`：Hero、Features、Pricing（仅展示）、FAQ、CTA
- 首页按 `site.config.ts` 的 `landing.sections` 数组决定显示哪些区块、按什么顺序
- 文案全部来自 `messages`，图片路径来自配置
- Pricing 区块读取 `billing.plans` 的展示字段；schema 在这里加入 `plans` 的展示部分，购买按钮在 T304 接上

**不做**：结账、真实价格对接

**验收**

- [ ] 调整 `landing.sections` 的顺序或删除某个区块后，首页相应变化
- [ ] 移动端 Lighthouse Performance ≥ 90

**测试**：e2e 断言各区块渲染，并验证关闭某个区块后它不再出现

---

## T106 seo

- 分支 / worktree：`feat/seo` → `../sass-seo`
- 依赖：T104

**做**

- `src/core/seo/metadata.ts`：`buildMetadata()` 统一生成 title 模板、description、canonical、hreflang alternates、Open Graph、Twitter
- `sitemap.ts`：营销路由 × 语言
- `robots.ts`：禁止抓取 `/dashboard`、`/admin`、`/api`
- `opengraph-image.tsx`：用 `next/og` 生成带品牌的默认 OG 图
- JSON-LD：Organization、WebSite

**不做**：博客相关 SEO（放在 T501）

**验收**

- [ ] 首页 HTML 中包含 canonical、hreflang、og:image
- [ ] `/sitemap.xml` 和 `/robots.txt` 输出正确

**测试**：用 Vitest 对 sitemap 输出做快照；用 e2e 断言首页 meta 标签

---

## T107 legal

- 分支 / worktree：`feat/legal` → `../sass-legal`
- 依赖：T104

**做**

- 页面：`/privacy`、`/terms`、`/refund`（支付平台审核通常要求有退款政策）
- 模板放在 `content/legal/`（归业务方所有，修改不会与上游冲突），用 TSX 编写，变量取自配置 `legal`：公司或个人名称、联系邮箱、适用法域、生效日期
- 在模板代码注释和 README 里注明"模板仅供参考，不构成法律意见"，这句话不显示在线上页面
- 在 Footer 中加入这三个链接

**不做**：多语言版本的法律文本

**验收**

- [ ] 修改 `legal.companyName` 后，三个页面同步更新
- [ ] 三个页面都有独立的 metadata

**测试**：e2e 断言三个页面返回 200 且包含配置中的公司名

---

## T108 deploy

- 分支 / worktree：`chore/deploy` → `../sass-deploy`
- 依赖：T105、T106、T107
- 外部依赖：Vercel 账号、域名

**做**

- 把 Vercel 项目关联到 GitHub 仓库：`main` 自动部署到生产环境，每个 PR 生成预览部署
- 在 README 写"快速开始"：使用模板 → 修改配置 → 本地运行
- 在 README 写"上线清单"：域名、DNS、Vercel 环境变量、按已开启模块列出所需的外部账号
- 在 GitHub 上把 `ci` 设为 `main` 分支保护的必需检查

**不做**：数据库、认证相关的部署配置（各自任务里补充到上线清单）

**验收**

- [ ] PR 能拿到预览 URL
- [ ] 合入 `main` 后生产域名可以访问，HTTPS 正常

**测试**：人工访问生产 URL，完成冒烟检查
