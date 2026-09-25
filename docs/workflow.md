# 开发流程

## 硬规则

1. **不在 `main` 上提交。** 所有改动都走 PR 合入。
2. **一个任务 = 一个分支 = 一个 worktree = 一个 PR。** 任务定义见 [tasks/README.md](tasks/README.md)。
3. **worktree 放在项目同级目录，命名 `sass-<topic>`。** `<topic>` 用任务的 topic 字段。
4. **每个 PR 合入后 `main` 必须可用**：CI 全绿，且不依赖尚未合入的任务。

## 命名

| 项       | 规则                                                        | 例子                              |
| -------- | ----------------------------------------------------------- | --------------------------------- |
| topic    | 小写 kebab-case，来自任务表                                 | `i18n`                            |
| 分支     | `<type>/<topic>`，type 取 `feat` / `fix` / `docs` / `chore` | `feat/i18n`                       |
| worktree | `../sass-<topic>`                                           | `../sass-i18n`                    |
| PR 标题  | `<任务ID> <type>: <描述>`                                   | `T104 feat: next-intl 多语言路由` |
| 提交信息 | Conventional Commits                                        | `feat(i18n): add locale switcher` |

## 开始一个任务

在主仓库目录（`sass/`）下执行：

```bash
git fetch origin
git worktree add ../sass-<topic> -b <type>/<topic> origin/main
cd ../sass-<topic>
pnpm install   # T101 合入之后才有
```

开工前确认任务的依赖都已合入 `main`。

## 提交 PR

```bash
git push -u origin <type>/<topic>
gh pr create --base main --title "<任务ID> <type>: <描述>" --body-file <说明文件>
```

PR 描述需要包含：

- 对应的任务 ID，以及任务文档的链接
- 验收项逐条勾选
- 测试方式和结果
- 新增的 env 或外部依赖（如果有）

**同一个 PR 里要把任务表中该任务的状态改成 `done`。**

## 合入与清理

- 用 squash merge，合入后删除远程分支。
- 清理本地：

```bash
cd ../sass
git worktree remove ../sass-<topic>
git branch -d <type>/<topic>
git pull --ff-only
```

## GitHub 仓库设置

建好远程仓库后，对 `main` 开启分支保护：

- 必须通过 PR 合入（Require a pull request before merging）
- T101 合入后，要求 CI 通过（Require status checks: `ci`）
- 禁止 force push
