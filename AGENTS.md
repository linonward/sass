# AGENTS.md

出海 SaaS 模板仓库。方案：[docs/plan.md](docs/plan.md)；任务：[docs/tasks/README.md](docs/tasks/README.md)；视觉系统：[docs/design.md](docs/design.md)。

改界面前先读 `docs/design.md`：整站颜色从一个配置色推导，表面深度靠 `--edge` 驱动的贴纸描边和硬唇边，不用模糊投影。改动 UI 时至少跑 `pnpm test` 和 `npx playwright test e2e/ui-shell.spec.ts e2e/landing.spec.ts`，那里锁着品牌色、可访问名和 375px 不横向溢出。

## Hard rules

- 不在 `main` 上提交。所有改动通过 PR 合入。
- 一个任务 = 一个分支 = 一个 worktree = 一个 PR。流程见 [docs/workflow.md](docs/workflow.md)。
- worktree 放在项目同级目录：`../sass-<topic>`，分支 `<type>/<topic>`，topic 取自任务表。
- 开工前确认任务依赖已合入 `main`；PR 内同步更新任务表状态。
- 套件代码放 `src/core/`；不要把业务逻辑写进 `src/core/`。
- 依赖版本以官方文档最新稳定版为准，不凭记忆写。
- 不引入第二种语言或运行时（TypeScript + Node 单栈）。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
