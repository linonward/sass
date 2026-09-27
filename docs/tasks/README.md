# 任务路径

方案见 [../plan.md](../plan.md)，流程见 [../workflow.md](../workflow.md)。

每个任务单独开 worktree、单独提交 PR。合入后 `main` 始终可用。每个阶段结束时，模板都能直接用于某一类真实项目。

## 总览

| ID                          | topic                   | 分支                           | 依赖                      | 状态 |
| --------------------------- | ----------------------- | ------------------------------ | ------------------------- | ---- |
| T001                        | plan                    | `docs/plan`                    | —                         | done |
| **阶段 1：落地站**          |                         |                                |                           |      |
| T101                        | scaffold                | `chore/scaffold`               | T001                      | done |
| T102                        | config                  | `feat/config`                  | T101                      | done |
| T103                        | ui-shell                | `feat/ui-shell`                | T102                      | done |
| T104                        | i18n                    | `feat/i18n`                    | T103                      | done |
| T105                        | landing                 | `feat/landing`                 | T104                      | done |
| T106                        | seo                     | `feat/seo`                     | T104                      | done |
| T107                        | legal                   | `feat/legal`                   | T104                      | done |
| T108                        | deploy                  | `chore/deploy`                 | T105, T106, T107          | done |
| **阶段 2：登录**            |                         |                                |                           |      |
| T201                        | db                      | `feat/db`                      | T102                      | done |
| T202                        | email                   | `feat/email`                   | T102, T104                | done |
| T203                        | auth                    | `feat/auth`                    | T201, T202, T103          | done |
| T204                        | dashboard               | `feat/dashboard`               | T203                      | done |
| **阶段 3：收款**            |                         |                                |                           |      |
| T301                        | billing-core            | `feat/billing-core`            | T201                      | done |
| T302                        | credits                 | `feat/credits`                 | T201                      | done |
| T303                        | creem                   | `feat/creem`                   | T301, T302, T203          | done |
| T304                        | pricing                 | `feat/pricing`                 | T303, T105                | done |
| T305                        | billing-emails          | `feat/billing-emails`          | T303, T202                | done |
| **阶段 4：AI 工具**         |                         |                                |                           |      |
| T401                        | ratelimit               | `feat/ratelimit`               | T102                      | done |
| T402                        | ai                      | `feat/ai`                      | T302, T401, T203          | done |
| T403                        | upload                  | `feat/upload`                  | T401, T203                | done |
| T404                        | ai-image                | `feat/ai-image`                | T402, T403                | done |
| T405                        | ai-video                | `feat/ai-video`                | T404                      | done |
| **阶段 5：内容与运营**      |                         |                                |                           |      |
| T501                        | blog                    | `feat/blog`                    | T104, T106                | done |
| T502                        | admin                   | `feat/admin`                   | T203, T302, T303          | done |
| T503                        | starter-guide           | `docs/starter-guide`           | 阶段 1–5 全部             | done |
| **阶段 6：可观测性**        |                         |                                |                           |      |
| T601                        | logger                  | `feat/logger`                  | 阶段 1–5                  | done |
| T602                        | sentry                  | `feat/sentry`                  | T601                      | done |
| T603                        | web-analytics           | `feat/web-analytics`           | T601                      | done |
| T604                        | admin-metrics           | `feat/admin-metrics`           | T502                      | done |
| **阶段 7：视觉重设计**      |                         |                                |                           |      |
| T605                        | redesign                | `feat/redesign`                | T108, T604                | done |
| T606                        | redesign-app            | `feat/redesign-app`            | T605                      | done |
| T607                        | redesign-rest           | `feat/redesign-rest`           | T606                      | done |
| **阶段 8：商品化**          |                         |                                |                           |      |
| T801                        | sell-plan               | `docs/sell-plan`               | 阶段 1–7                  | done |
| T802                        | license                 | `docs/license`                 | T801                      | done |
| T803                        | fake-billing-gate       | `fix/fake-billing-gate`        | T801                      | done |
| T804                        | neutral-config          | `fix/neutral-config`           | T801                      | done |
| T805                        | prod-env-guards         | `fix/prod-env-guards`          | T801                      | done |
| T806                        | security-headers        | `feat/security-headers`        | T801                      | done |
| T807                        | dep-overrides           | `fix/dep-overrides`            | T801                      | done |
| T808                        | deps-hygiene            | `chore/deps-hygiene`           | T801                      | done |
| T809                        | refund-credits          | `feat/refund-credits`          | T801                      | done |
| T810                        | ts-strictness           | `chore/ts-strictness`          | T801                      | done |
| T811                        | distribution            | `chore/distribution`           | T801                      | done |
| T812                        | brand-assets            | `fix/brand-assets`             | T801                      | done |
| T813                        | prod-sentinels          | `fix/prod-sentinels`           | T801                      | done |
| T817                        | typecheck-env           | `fix/typecheck-env`            | T801                      | done |
| T814                        | harden-misc             | `fix/harden-misc`              | T801                      | done |
| T815                        | seed-data               | `feat/seed-data`               | T801                      | done |
| T816                        | llms-txt                | `feat/llms-txt`                | T801                      | done |
| T818                        | dep-ignore-types-node   | `chore/dep-ignore-types-node`  | T801                      | done |
| **阶段 9：错误路径与边界**  |                         |                                |                           |      |
| T901                        | review-cards            | `docs/review-cards`            | —                         | done |
| T902                        | not-found               | `fix/not-found`                | T901                      | done |
| T903                        | error-metadata          | `fix/error-metadata`           | T901                      | done |
| T904                        | error-e2e               | `chore/error-e2e`              | T902, T903                | done |
| T905                        | boundary-notes          | `docs/boundary-notes`          | T901                      | done |
| **阶段 10：渲染与包体积**   |                         |                                |                           |      |
| T1001                       | config-leaf             | `fix/config-leaf`              | T901                      | done |
| T1002                       | playground-stream       | `fix/playground-stream`        | T901                      | done |
| T1003                       | playground-tabs         | `fix/playground-tabs`          | T901, T1002               | done |
| T1004                       | serial-queries          | `fix/serial-queries`           | T901                      | done |
| **阶段 11：登录体验**       |                         |                                |                           |      |
| T1101                       | one-tap                 | `feat/one-tap`                 | T203                      | done |
| **阶段 12：第三轮审查修复** |                         |                                |                           |      |
| T1200                       | review-cards            | `docs/review-cards`            | —                         | done |
| T1201                       | video-timezone          | `fix/video-timezone`           | T1200                     | done |
| T1202                       | refund-reclaim          | `fix/refund-reclaim`           | T1200                     | done |
| T1203                       | video-settle-race       | `fix/video-settle-race`        | T1201                     | done |
| T1204                       | checkout-idempotency    | `fix/checkout-idempotency`     | T1200                     | done |
| T1205                       | favicon                 | `fix/favicon`                  | T1200                     | todo |
| T1206                       | template-handoff        | `fix/template-handoff`         | T1200                     | todo |
| T1207                       | notices-sync            | `fix/notices-sync`             | T1200                     | todo |
| T1208                       | seed-gate               | `fix/seed-gate`                | T1200                     | done |
| T1209                       | not-found-canonical     | `fix/not-found-canonical`      | T1200                     | todo |
| T1210                       | serial-queries-2        | `fix/serial-queries-2`         | T1200                     | todo |
| T1211                       | ui-a11y-i18n            | `fix/ui-a11y-i18n`             | T1200                     | todo |
| T1212                       | blog-sitemap            | `fix/blog-sitemap`             | T1200                     | todo |
| T1213                       | overflow-e2e            | `chore/overflow-e2e`           | T1200                     | todo |
| T1214                       | readme-drift            | `docs/readme-drift`            | T1200                     | todo |
| T1215                       | email-outbox            | `fix/email-outbox`             | T1200                     | todo |
| T1216                       | ratelimit-selfhost      | `fix/ratelimit-selfhost`       | T1200                     | todo |
| T1217                       | frontend-details        | `chore/frontend-details`       | T1200                     | todo |
| T1218                       | docker-notes            | `docs/docker-notes`            | T1200                     | todo |
| **阶段 13：获客**           |                         |                                |                           |      |
| T1300                       | acquisition-plan        | `docs/acquisition-plan`        | —                         | done |
| T1301                       | acquisition-attribution | `feat/acquisition-attribution` | T1300, T102, T203         | done |
| T1302                       | acquisition-report      | `feat/acquisition-report`      | T1301, T604, T1202        | todo |
| T1303                       | lead-capture            | `feat/lead-capture`            | T1301, T202, T401         | done |
| T1304                       | lead-management         | `feat/lead-management`         | T1303, T1302, T502        | todo |
| T1305                       | referral-links          | `feat/referral-links`          | T1301, T203, T204, T302   | todo |
| T1306                       | referral-rewards        | `feat/referral-rewards`        | T1305, T303, T1202, T1204 | todo |

阶段 8 分三批（见 [phase-8-sell.md](phase-8-sell.md)）：批次 A（T802–T808）上架阻塞，批次 B（T809–T813、T817）上架前建议，批次 C（T814–T816、T818）可后做。T816 是「卖点」项：买家拿到的是 AI agent 能直接读的站点索引。T817 不在原始审查清单里，是 2026-09-26 验证依赖升级时实测到的；T818 是 T808 那张 dependabot 配置的补丁（`@types/node` 的大版本要跟运行时走，不能让 dependabot 自己提）。

阶段 9 分两批（见 [phase-9-boundaries.md](phase-9-boundaries.md)）：批次 A（T902–T903）修用户可见缺陷，批次 B（T904–T905）防退化。T902 与 T903 互不依赖可并行；T904 要锁的是它们修好后的行为，所以依赖两者。

阶段 10 分三批（见 [phase-10-render.md](phase-10-render.md)）：批次 A（T1001）单条收益最大且完全独立，批次 B（T1002–T1003）都落在 playground 区域建议顺序做，批次 C（T1004）随时可做。

阶段 9 与阶段 10 由 T901 一并落卡 —— 两轮审查（Vercel 70 条规则、错误路径）是同一次做的，所以共用一个规划任务，阶段 10 不再单设。

阶段 11 只有一个任务（见 [phase-11-one-tap.md](phase-11-one-tap.md)）：登录页加 Google One Tap。它不改登录能力本身，只把「跳去 Google 再跳回来」压缩成「点一下头像」；没配 Google 凭据时行为与现在完全一致。

阶段 12 分四批（见 [phase-12-review.md](phase-12-review.md)）：批次 A（T1201–T1204）结算加固 —— 退款/结算的资损路径加一条环境正确性（T1201 的会话时区，落卡时实测把原 high 论断推翻并重新定性）；批次 B（T1205–T1209）交付闭环；批次 C（T1210–T1214）体验与防线；批次 D（T1215–T1218）可后置。批次内基本可并行，唯一的硬顺序是 T1203 在 T1201 之后（同改 `src/core/ai/video.ts`）。T1204 自带一步 Creem test mode 实测，`requestId` 幂等语义的结论决定之后改多少。本轮审查结论与「明确不修 / 待定」清单写在 phase-12 文档开头。

阶段 7 分两个语域做：T605 是**营销面 + 设计基础**，T606 是**登录后产品面 + 后台**，T607 收尾剩下的营销侧细节页（blog 列表卡片与文章页、legal、404）和那几处还没换成 `--primary-text` 的链接。（2026-09-26 错误路径审计给 T607 补了两条：错误页 CTA 用错语域、h1 未用 display 字体。）

阶段 13 分三块（见 [phase-13-acquisition.md](phase-13-acquisition.md)）：渠道归因与报表（T1301–T1302）、线索收集与管理（T1303–T1304）、邀请链接与积分奖励（T1305–T1306）。T1300 完成规划，T1301 完成渠道归因基础，T1303 完成邮箱留资，其余实施任务为 todo；T1302 等待 T1202 的退款修复，T1306 等待 T1202、T1204 合入。首版不做现金返佣或营销群发。

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
         T402, T403 → T404 → T405

阶段 5   T104, T106 → T501
         T203, T302, T303 → T502
         全部 → T503

阶段 6   T601 ─┬→ T602
               └→ T603
         T502 → T604

阶段 8   T801 → T802 T803 T804 T805 T806 T807 T808（批次 A：上架阻塞）
         T801 → T809 T810 T811 T812 T813 T817（批次 B：上架前建议）
         T801 → T814 T815 T816 T818（批次 C：可后做）

阶段 9   T901 → T902 T903（批次 A：用户可见缺陷，两条可并行）
         T901 → T905（批次 B：文档）
         T902, T903 → T904（批次 B：测试，锁住修好后的行为）

阶段 10  T901 → T1001（批次 A：包体积）
         T901 → T1002 → T1003（批次 B：playground，同一个文件建议顺序做）
         T901 → T1004（批次 C：串行查询）

阶段 11  T203 → T1101

阶段 12  T1200 → 批次 A T1201–T1204（T1201 → T1203）
         T1200 → 批次 B T1205–T1209
         T1200 → 批次 C T1210–T1214
         T1200 → 批次 D T1215–T1218

阶段 13  T1300, T102, T203 → T1301
         T1301, T604, T1202 → T1302
         T1301, T202, T401 → T1303
         T1303, T1302, T502 → T1304
         T1301, T203, T204, T302 → T1305
         T1305, T303, T1202, T1204 → T1306
```

## 推荐顺序

单人串行推进：

T101 → T102 → T103 → T104 → T105 → T106 → T107 → T108 → T201 → T202 → T203 → T204 → T301 → T302 → T303 → T304 → T305 → T401 → T402 → T403 → T404 → T405 → T501 → T502 → T503

阶段 13：T1300 → T1301 → T1302 → T1303 → T1304 → T1305 → T1306；遇到 T1202/T1204 未合入时，先推进依赖已满足的任务。

可以并行的任务（分别开 worktree）：T105 / T106 / T107；T201 / T202；T301 / T302；T401 在 T102 之后随时可做；T601 / T604；T602 / T603；阶段 8 批次内全部并行（见 phase-8-sell.md）；阶段 9 的 T902 / T903 / T905；阶段 10 的 T1001 / T1004；阶段 12 批次内除 T1203 外全部（T1203 在 T1201 之后，见 phase-12-review.md）。

## 任务详情

- [阶段 1：落地站](phase-1-landing.md)
- [阶段 2：登录](phase-2-auth.md)
- [阶段 3：收款](phase-3-billing.md)
- [阶段 4：AI 工具](phase-4-ai.md)
- [阶段 5：内容与运营](phase-5-content-ops.md)
- [阶段 6：可观测性](phase-6-observability.md)
- [阶段 7：视觉重设计](phase-7-redesign.md)
- [阶段 8：商品化](phase-8-sell.md)
- [阶段 9：错误路径与边界](phase-9-boundaries.md)
- [阶段 10：渲染与包体积](phase-10-render.md)
- [阶段 11：登录体验](phase-11-one-tap.md)
- [阶段 12：第三轮审查修复](phase-12-review.md)
- [阶段 13：获客](phase-13-acquisition.md)
