# 任务路径

方案见 [../plan.md](../plan.md)，流程见 [../workflow.md](../workflow.md)。

每个任务单独开 worktree、单独提交 PR。合入后 `main` 始终可用。每个阶段结束时，模板都能直接用于某一类真实项目。

## 总览

| ID                     | topic          | 分支                  | 依赖             | 状态 |
| ---------------------- | -------------- | --------------------- | ---------------- | ---- |
| T001                   | plan           | `docs/plan`           | —                | done |
| **阶段 1：落地站**     |                |                       |                  |      |
| T101                   | scaffold       | `chore/scaffold`      | T001             | done |
| T102                   | config         | `feat/config`         | T101             | done |
| T103                   | ui-shell       | `feat/ui-shell`       | T102             | done |
| T104                   | i18n           | `feat/i18n`           | T103             | done |
| T105                   | landing        | `feat/landing`        | T104             | done |
| T106                   | seo            | `feat/seo`            | T104             | done |
| T107                   | legal          | `feat/legal`          | T104             | done |
| T108                   | deploy         | `chore/deploy`        | T105, T106, T107 | done |
| **阶段 2：登录**       |                |                       |                  |      |
| T201                   | db             | `feat/db`             | T102             | done |
| T202                   | email          | `feat/email`          | T102, T104       | done |
| T203                   | auth           | `feat/auth`           | T201, T202, T103 | done |
| T204                   | dashboard      | `feat/dashboard`      | T203             | done |
| **阶段 3：收款**       |                |                       |                  |      |
| T301                   | billing-core   | `feat/billing-core`   | T201             | done |
| T302                   | credits        | `feat/credits`        | T201             | done |
| T303                   | creem          | `feat/creem`          | T301, T302, T203 | done |
| T304                   | pricing        | `feat/pricing`        | T303, T105       | todo |
| T305                   | billing-emails | `feat/billing-emails` | T303, T202       | todo |
| **阶段 4：AI 工具**    |                |                       |                  |      |
| T401                   | ratelimit      | `feat/ratelimit`      | T102             | todo |
| T402                   | ai             | `feat/ai`             | T302, T401, T203 | todo |
| T403                   | upload         | `feat/upload`         | T401, T203       | todo |
| **阶段 5：内容与运营** |                |                       |                  |      |
| T501                   | blog           | `feat/blog`           | T104, T106       | todo |
| T502                   | admin          | `feat/admin`          | T203, T302, T303 | todo |
| T503                   | starter-guide  | `docs/starter-guide`  | 阶段 1–5 全部    | todo |

状态取值：`todo` / `in-progress` / `in-review` / `done`。在任务自己的 PR 里更新。

## 依赖图

```
阶段 1   T101 → T102 → T103 → T104 ─┬→ T105 ─┐
                                    ├→ T106 ─┼→ T108
                                    └→ T107 ─┘

阶段 2   T102 → T201 ─┐
         T104 → T202 ─┼→ T203 → T204
         T103 ────────┘

阶段 3   T201 → T301 ─┐
         T201 → T302 ─┼→ T303 ─┬→ T304 ← T105
         T203 ────────┘        └→ T305 ← T202

阶段 4   T102 → T401 ─┬→ T402 ← T302, T203
                      └→ T403 ← T203

阶段 5   T104, T106 → T501
         T203, T302, T303 → T502
         全部 → T503
```

## 推荐顺序

单人串行推进：

T101 → T102 → T103 → T104 → T105 → T106 → T107 → T108 → T201 → T202 → T203 → T204 → T301 → T302 → T303 → T304 → T305 → T401 → T402 → T403 → T501 → T502 → T503

可以并行的任务（分别开 worktree）：T105 / T106 / T107；T201 / T202；T301 / T302；T401 在 T102 之后随时可做。

## 任务详情

- [阶段 1：落地站](phase-1-landing.md)
- [阶段 2：登录](phase-2-auth.md)
- [阶段 3：收款](phase-3-billing.md)
- [阶段 4：AI 工具](phase-4-ai.md)
- [阶段 5：内容与运营](phase-5-content-ops.md)
