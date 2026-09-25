# sass

可复用的出海 SaaS 模板：改配置即可得到登录、支付（Creem）、积分、AI、多语言、SEO 等基础设施，只需编写业务功能。

当前处于搭建阶段，进度见任务表。

- 方案：[docs/plan.md](docs/plan.md)
- 任务路径：[docs/tasks/README.md](docs/tasks/README.md)
- 开发流程：[docs/workflow.md](docs/workflow.md)

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
- 多语言：next-intl，文案在 `messages/<locale>.json`。新增语言见 [docs/i18n.md](docs/i18n.md)。
- SEO：页面 metadata 用 `buildMetadata()`（`src/core/seo/metadata.ts`）生成 canonical、hreflang、Open Graph 和 Twitter；新增营销页时在 `src/core/seo/routes.ts` 登记，sitemap 会自动收录。站点 URL 取自 `domain`。
- UI 组件：shadcn/ui（Base UI），生成到 `src/core/ui/`。新增组件用 `pnpm dlx shadcn@latest add <name>`。
- 环境变量：复制 `.env.example` 为 `.env.local` 后填写，由 `src/core/env.ts` 校验。关闭的 feature 不要求对应变量。设置 `SKIP_ENV_VALIDATION=1` 可跳过校验。

CI（`.github/workflows/ci.yml`）按 lint → format → typecheck → test → build → e2e 顺序执行。
