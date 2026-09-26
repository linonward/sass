# 阶段 8：商品化（上架准备）

阶段完成后：模板可以合法售卖；买家 fork 后第一次上手不被卖家痕迹卡住；代码能通过买家的安全评审。

依据：2026-09-26 的四路深度审查（安全 / 商品化 / 架构与代码质量 / 依赖供应链）与 LICENSE 选型决策（**专有 EULA**）。

## 批次

- **批次 A（上架阻塞）**：T802–T808。不完成不能上架。
- **批次 B（上架前建议）**：T809–T813。买家体验 / 评审会点名。
- **批次 C（可后做）**：T814–T815。

批次内任务无相互依赖，可并行开 worktree。

---

## T802 license

- 分支 / worktree：`docs/license` → `../sass-license`
- 依赖：T801
- 审查：C1（Critical）

**做**

- 新增 `LICENSE`：专有 EULA，覆盖四点——
  - 授予买家非独占、不可转让的权利：用模板构建并运营**不限数量的自有产品**（可商用、可闭源、可修改模板代码）
  - 禁止：把模板本身或其修改版再分发、转售、开源、出租
  - 免责声明（AS-IS，不含保修）与责任限制（总额上限 = 购买金额）
  - 授权随付款生效，单一买家实体
- `package.json` 加 `"license": "SEE LICENSE IN LICENSE"`
- 新增 `THIRD-PARTY-NOTICES.md`：列出主要依赖及其许可（审查结论：838 MIT / 89 Apache-2.0，无 GPL/AGPL/SSPL；唯一 LGPL 是 sharp 原生二进制，SaaS 场景无需处理）
- README 加「授权」一节：一句话说明买家能做什么、不能做什么，指向 LICENSE

**不做**：在线授权系统 / 密钥激活、每客户定制授权文本、法律意见书（README 注明文本供参考、正式售卖前建议律师过目）

**验收**

- [ ] 根目录有 LICENSE、THIRD-PARTY-NOTICES.md；`package.json` 有 license 字段
- [ ] EULA 覆盖「可用 / 禁再分发 / 免责 / 责任上限」四点

**测试**：无代码改动；CI 全绿即可

---

## T803 fake-billing-gate

- 分支 / worktree：`fix/fake-billing-gate` → `../sass-fake-billing-gate`
- 依赖：T801
- 审查：C2（Critical）

**做**

- `fakeBillingAllowed()` 改为显式条件：`NODE_ENV !== "production"` 且 `CREEM_MODE !== "live"`；新增 env `ALLOW_FAKE_BILLING`（可选，默认关闭），显式设置时放行
- 自托管生产（`next start` / Docker / 无 VERCEL_ENV）下 `BILLING_PROVIDER=fake` 启动即报错（env 校验），不再静默可用
- fake 结账与 fake webhook 路由在非允许环境直接 404（与现有"非 fake 时 404"逻辑对齐）
- CI e2e 用 `ALLOW_FAKE_BILLING=1`（改 `.github/workflows/ci.yml`）；`.env.example` / README 说明新变量与自托管注意点

**不做**：改 fake provider 的票据机制本身（L4 硬编码密钥随本任务闸门收紧后风险已可控，彻底改另行评估）

**验收**

- [ ] 本地 `next dev` 下 fake 流程与 e2e 保持可用
- [ ] 生产构建下 `BILLING_PROVIDER=fake` 启动报错或路由 404
- [ ] 自托管场景（无 VERCEL_ENV + CREEM_MODE=test）不再默认放行

**测试**：Vitest 覆盖 `fakeBillingAllowed` 各组合；e2e 继续用 fake provider 全绿

---

## T804 neutral-config

- 分支 / worktree：`fix/neutral-config` → `../sass-neutral-config`
- 依赖：T801
- 审查：H1/H2/H3 + L6（三路确认的卖家痕迹）

**做**

- `site.config.ts` 换占位值：`domain: "example.com"`、`email.fromAddress: "noreply@example.com"`、两个 Creem 产品 ID → `prod_placeholder_pro` / `prod_placeholder_lifetime`（让 `checkout.ts` 的占位守卫按设计生效）
- 真实值不再进模板：演示站如需继续收款，加最小 env 覆盖（如 `SITE_DOMAIN` / `CREEM_PRODUCT_ID_PRO`，在 `site.config.ts` 读取时合并），README 说明
- 三份快照（seo/blog/email）重生成；同时把相关断言改为配置插值（`${siteConfig.domain}`），让买家改域名后 `pnpm test` 依然绿（不再依赖 `-u`）
- 清理注释里的卖家域名：`checkout.ts:59` JSDoc、`site.config.ts:158` R2 示例
- README「改成自己的站点」一步把「先跑 `pnpm test -u`」改为「改完直接跑 `pnpm test` 应全绿」

**验收**

- [ ] `src/`、`public/`、`content/`、`messages/`、`site.config.ts` 内 grep `linonward` 零命中（README / UPGRADING 的 upstream 地址除外）
- [ ] 买家把 domain / 色 / 文案改成任意值后，`pnpm test` 不重生成快照即全绿
- [ ] 占位配置下结账返回 `plan_not_configured`（守卫生效）

**测试**：调整后的单测 + e2e（配置驱动断言不受影响）

---

## T805 prod-env-guards

- 分支 / worktree：`fix/prod-env-guards` → `../sass-prod-env-guards`
- 依赖：T801
- 审查：H6/H8 + 安全 M4

**做**

- `emailServerEnv`：生产（`VERCEL_ENV === "production"` 或 `NODE_ENV === "production"`）时 `EMAIL_TRANSPORT` 只允许 `resend`；检测到「生产 + console/file」打显式 error
- `SKIP_ENV_VALIDATION` 只在 `NODE_ENV !== "production"` 时生效，生产强制校验
- `logger` 脱敏名单补 `otp` / `code` / `pin` / `verificationcode`，并加单测锁住
- README / `.env.example` 同步说明

**不做**：改 `EMAIL_TRANSPORT` 的默认选择逻辑（仍按 NODE_ENV 判断）

**验收**

- [ ] 生产环境设 `EMAIL_TRANSPORT=console` 启动报错
- [ ] 生产环境 `SKIP_ENV_VALIDATION=1` 不再跳过必填校验
- [ ] `logger.info("otp", { code })` 输出 `[redacted]`

**测试**：Vitest 覆盖三处新校验

---

## T806 security-headers

- 分支 / worktree：`feat/security-headers` → `../sass-security-headers`
- 依赖：T801
- 审查：安全 M2

**做**

- `next.config.ts` 加 `headers()` 全站下发：`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`X-Frame-Options: DENY`、`Permissions-Policy`（最小集）
- CSP 用 Next 官方 nonce 方案挂在 `src/proxy.ts`（或非交互式静态 CSP）；白名单留出 Sentry tunnel（`/monitoring`）与 Vercel Analytics / Speed Insights 域
- HSTS 在 README 上线清单里加一步（域名固定后自行开启），不在模板里默认开
- API 路由同样覆盖（matcher 排除 `/api` 时在 config 层下发）

**不做**：完整 CSP 报表收集、逐页面定制头

**验收**

- [ ] 部署后任意页面响应含上述头；`/admin` 不可被 iframe 嵌套
- [ ] Sentry 上报与 Analytics 不受 CSP 影响（e2e 断言无 CSP 违规报告）

**测试**：e2e 加响应头断言

---

## T807 dep-overrides

- 分支 / worktree：`fix/dep-overrides` → `../sass-dep-overrides`
- 依赖：T801
- 审查：H5 + audit moderate

**做**

- `pnpm.overrides` 强制 `toml >= 4.2.0`、`uuid >= 11.1.1`，跑 `pnpm test` + `pnpm build` + e2e（landing / blog 页面）验证 MDX frontmatter 解析无回归
- `pnpm audit` 清零 high / moderate（esbuild 那条除外——drizzle-kit 上游无解且不可利用，在 README 依赖说明里书面记录）
- 用现有博客文章回归 toml 主版本差异（3→4/5 的 TOML 语法兼容性）

**不做**：升级 mdx-bundler / content-collections 大版本

**验收**

- [ ] `pnpm audit` 无 high
- [ ] 博客渲染（首页列表 / 文章页 / frontmatter 字段）e2e 全绿

**测试**：现有 blog 测试 + e2e landing / blog

---

## T808 deps-hygiene

- 分支 / worktree：`chore/deps-hygiene` → `../sass-deps-hygiene`
- 依赖：T801
- 审查：H9/H10 + 多项 Low

**做**

- `shadcn` 移入 devDependencies（全仓无运行时 import，已核实）
- `@types/react` / `@types/react-dom` 与运行时 `react@19.2.8` 对齐（钉 19.2.x，或同步升 react——以 Next 16.3.6 peer 为准）
- `auth` CLI 与 `better-auth` 同一版本策略（都 `^1.7.5` 或都精确）
- `resend` 升级到最新稳定版（6.30.x）；`@sentry/nextjs` 保持 11.x，README 记录已验证版本
- 删除 `vite-tsconfig-paths`（Vitest 5 已内置 tsconfig paths 解析，改 `vitest.config.mts` 用原生配置）
- `tsconfig` `target` 升到 `ES2022`
- 加 `.github/dependabot.yml`（npm + github-actions，weekly）

**不做**：大版本升级（typescript 7 / eslint 10 受上游 peer 约束，维持现状并在注释里写明原因）

**验收**

- [ ] `pnpm install --prod` 不再安装 shadcn 树（无 MCP SDK / 第二个 zod）
- [ ] `pnpm test` / `pnpm build` / e2e 全绿
- [ ] `pnpm auth:generate` 产物与现有 schema 无 diff

**测试**：全量回归

---

## T809 refund-credits

- 分支 / worktree：`feat/refund-credits` → `../sass-refund-credits`
- 依赖：T801
- 审查：H4（真金白银口子）

**做**

- 退款事件回收集分：按未消耗比例回收集分，扣减用 clamp 策略（`balance >= 0` 的 CHECK 决定不能负扣：扣到 0，差额记 `credit_transactions` 欠账备注）
- 账本流水带 `refund` 来源，admin 后台可见
- 若实现代价过大（评估后）：退而在 README「已知限制」写明 v1 不扣回 + 原因 + 建议补法

**验收**

- [ ] 全额退款后用户余额不再保留购买发放的积分（clamp 边界正确）
- [ ] 重复退款 webhook 不重复扣减（幂等保持）

**测试**：Vitest 覆盖退款 clamp 边界、重复事件；集成测试覆盖 fake 退款流程

---

## T810 ts-strictness

- 分支 / worktree：`chore/ts-strictness` → `../sass-ts-strictness`
- 依赖：T801
- 审查：M3

**做**

- `tsconfig.json` 开启 `noUncheckedIndexedAccess`、`noUnusedLocals`、`noUnusedParameters`、`noImplicitOverride`、`noImplicitReturns`
- ESLint 加 `@typescript-eslint/no-unused-vars`（`argsIgnorePattern: "^_"`）
- 修全部暴露出的类型问题

**不做**：`exactOptionalPropertyTypes`、函数式风格重构

**验收**

- [ ] `pnpm typecheck` / `pnpm lint` 全绿且新规则生效
- [ ] 新规则在 CI 中执行

**测试**：全量回归

---

## T811 distribution

- 分支 / worktree：`chore/distribution` → `../sass-distribution`
- 依赖：T801
- 审查：M1 + M4（发货方式）

**做**

- 新增 `scripts/release-package.sh`：`git archive` 打包买家分发包，明确排除清单（`.vercel/`、`.env.local`、`.next/`、`.content-collections/`、`.tmp/`、`node_modules/`、`test-results/`、`playwright-report/`）
- 买家分发包剔除内部文档：`docs/tasks/**`、`docs/plan.md`、`docs/workflow.md`、`AGENTS.md`、`CLAUDE.md`（保留 README / UPGRADING / design / i18n）
- README 加「买家分发包包含什么」一节
- 打包脚本输出 zip + 校验：敏感文件零命中（grep 检查）

**验收**

- [ ] 脚本产出的包解压后：无 `.vercel`、无 `.env*`、无内部文档、`pnpm test` 可跑
- [ ] 包内 grep `linonward` 仅在 UPGRADING.md 的 upstream 地址（合理）

**测试**：脚本冒烟（打包 → 解压 → grep 断言）

---

## T812 brand-assets

- 分支 / worktree：`fix/brand-assets` → `../sass-brand-assets`
- 依赖：T801
- 审查：M7

**做**

- logo 着色方案改为 `currentColor` + CSS（`text-primary`），让 logo 真正跟随 `brand.primaryColor`；README 第 3 步单独写明 logo 换法
- 删除死资源 `public/landing/hero.svg` / `hero-dark.svg`（全仓无引用）
- `--chart-1` 接入 `brandCss()` 派生或删除

**不做**：Logo 设计服务、多主题 logo 变体

**验收**

- [ ] 换 `primaryColor` 后 logo / 图表色同步变化，无需改 SVG 文件
- [ ] 删除死资源后构建与 e2e 全绿

**测试**：现有 brand-css 测试扩展；e2e ui-shell 不变

---

## T813 prod-sentinels

- 分支 / worktree：`fix/prod-sentinels` → `../sass-prod-sentinels`
- 依赖：T801
- 审查：M2 + M5

**做**

- 占位哨兵：`legal.companyName === "Acme Inc."` 或 `domain === "example.com"` 等未定制状态，dev 打 warning、生产构建报错
- `upload.public` 默认改 `false`（签名 URL 访问），README 说明公开模式的代价
- admin 降级：提供降级 SQL 或 `pnpm admin:demote <email>` 脚本（`ADMIN_EMAILS` 移除不收回权限的已知缺口）

**不做**：admin 角色 UI 管理界面

**验收**

- [ ] 占位配置下生产构建失败并给出明确提示
- [ ] 演示站配置真实值后构建正常
- [ ] 降级脚本执行后该用户失去 admin

**测试**：Vitest 覆盖哨兵校验；降级脚本对测试库验证

---

## T814 harden-misc

- 分支 / worktree：`fix/harden-misc` → `../sass-harden-misc`
- 依赖：T801
- 审查：多项 Low 汇总

**做**

- 上传 `handleComplete` / `handleFileRedirect` 复用 `checkRateLimit("upload")`
- `trace.getTracer("sass")` 改用 `siteConfig.name`；`Symbol.for("sass.observability.sentry")` 改中性键
- 自托管文档：XFF 正确重写的 Nginx / Caddy 配置示例（限流按 IP 依赖反代）
- README 依赖说明：esbuild moderate 不可利用的书面结论、Sentry 新 major 的版本策略

**不做**：新功能

**验收**

- [ ] 上传三接口均限流
- [ ] tracer 名跟随配置

**测试**：限流单测扩展；回归全绿

---

## T815 seed-data

- 分支 / worktree：`feat/seed-data` → `../sass-seed-data`
- 依赖：T801
- 审查：I3 备注（不阻塞销售）

**做**

- `pnpm db:seed`：造演示数据（示例用户、订阅、积分流水），幂等可重复执行
- README「先看看有数据长什么样」一节

**不做**：大规模 fake 数据工厂

**验收**

- [ ] 空库跑 seed 后 dashboard / admin 有可看数据
- [ ] 重复执行不报错不重复插入

**测试**：seed 脚本对测试库执行 + 断言
