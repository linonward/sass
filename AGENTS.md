# AGENTS.md

出海 SaaS 模板仓库。方案：[docs/plan.md](docs/plan.md)；任务：[docs/tasks/README.md](docs/tasks/README.md)。

## Hard rules

- 不在 `main` 上提交。所有改动通过 PR 合入。
- 一个任务 = 一个分支 = 一个 worktree = 一个 PR。流程见 [docs/workflow.md](docs/workflow.md)。
- worktree 放在项目同级目录：`../sass-<topic>`，分支 `<type>/<topic>`，topic 取自任务表。
- 开工前确认任务依赖已合入 `main`；PR 内同步更新任务表状态。
- 套件代码放 `src/core/`；不要把业务逻辑写进 `src/core/`。
- 依赖版本以官方文档最新稳定版为准，不凭记忆写。
- 不引入第二种语言或运行时（TypeScript + Node 单栈）。
