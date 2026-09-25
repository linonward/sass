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

CI（`.github/workflows/ci.yml`）按 lint → format → typecheck → test → build → e2e 顺序执行。
