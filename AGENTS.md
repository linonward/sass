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
- 环境变量（local / CI / prod 的值）以飞书多维表格为准：改值先改表，再用 `node .claude/skills/env-sync/scripts/sync.mjs` 核对和同步，见 [env-sync skill](.claude/skills/env-sync/SKILL.md)。
- 不引入第二种语言或运行时（TypeScript + Node 单栈）。
- 随发行包交付的内容（代码注释、测试标题、报错 / 日志 / 脚本输出、买家文档）一律用英文；界面文案走 `messages/*.json`。不随包的内部文档（`docs/plan.md`、`docs/tasks/**`、`docs/workflow.md`、`docs/go-to-market.md`、`docs/competitive-landscape.md`、本文件）保持中文。随包口径以 `scripts/release-package.sh` 的排除清单为准，见 [阶段 26](docs/tasks/phase-26-english.md)。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
