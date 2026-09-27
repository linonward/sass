# 阶段 14：审查后续小项

阶段完成后：第三轮审查（阶段 12）与并行实施过程中记录下来的**遗留小项**收口 —— 交付物里不再有内部任务编号，`e2e` 不再有已知的间歇性失败。

依据：阶段 12 实施期间各任务报告里显式记录的「没做/待决策」项（T1206 / T1212 / T1214 / T1218 的报告与 PR 描述），以及 T1211 对 CI flake 的定位（把同一条失败追到 main 自己的 CI annotation 与 trace，确认与本改动无关）。

## 批次

- **T1401**（源码注释里的内部编号）与 **T1402**（e2e flaky）互不重叠，可并行。
- 两个都做完本阶段即结束；没有再往下拆的项。

## 明确不修 / 待定

- **standalone 的 `HOSTNAME=0.0.0.0` 坑**：T1218 实测发现（`127.0.0.1` 会让全站自环 307），已写进 README 自托管一节，不单独立卡 —— 参考 Dockerfile 是否要补由 `docs/plan.md` 的「v1 不做 Docker 部署」决定（T1218 的取舍记录在它的 PR 里）。
- **`scripts/release-package.sh` 随买家交付**：它既是卖家出包工具、也在 zip 里（买家会看到一个打包脚本）。无害且已文档化，暂不处理。
- **删掉 `docs/plan.md` / `docs/tasks/` 后 `src/` 里的注释会成死链**：T1206 已在 README 的删除清单里说明（注释不影响运行）。

---

## T1401 internal-terms

- 分支 / worktree：`chore/internal-terms` → `../sass-internal-terms`
- 依赖：—
- 依据：T1212 / T1214 报告（两个 agent 各自建议单开一张卡）

**问题**

阶段 12 清掉了买家文档里的内部术语（README / UPGRADING / design.md / plan.md），但**交付代码与配置里的同类别名残留**（买家读得到，且对不上任何他们能看到的东西）：

- `src/` 里 9 处 `T###` 注释（`grep -rn "T[0-9]\{3\}" src/ --include="*.ts" --include="*.tsx" | grep -v "\.test\."`）：`src/core/config/schema.ts:128,146,347,349`、`src/core/observability/logger.ts:13`、`src/core/db/schema/billing.ts:2`、`src/core/billing/webhook.ts:13`、`src/core/billing/cancel-on-user-delete.ts:15`（如「由 T301 / T303 添加」「T602 用它接 Sentry」「T204 会中止删除」）。测试里还有更多。
- `site.config.ts:197`：「线索与邀请的实现见**阶段 13 后续任务**」。
- `README.md:593`（获客一节）：「`acquisition.referrals` 仍为**后续任务**预留开关」。

**做**

- 逐处改写成自洽表述：能指向买家可见文档的（README 章节、`docs/design.md`）就指过去，否则内联一句说明；**不要**只是删掉编号留下断句。
- 测试文件里的 `T###` 一并扫（`src/**/*.test.*`、`e2e/`），别只改非测试文件。
- 检查方法：改完 `grep -rn "T[0-9]\{3\}" src/ e2e/ site.config.ts README.md UPGRADING.md` 应为 0 命中（`docs/` 内部文档与 `AGENTS.md`/`CLAUDE.md` 不算 —— 它们不进买家包）。

**不做**：改 `docs/tasks/` 或 `docs/plan.md` 里的编号（那是内部文档，本来就是给任务的）；重命名任何代码标识符。

**验收**

- [ ] `src/`、`e2e/`、`site.config.ts`、`README.md`、`UPGRADING.md` 里 `T[0-9]{3}` 零命中
- [ ] `pnpm test` + `pnpm typecheck` + `pnpm lint` 全绿
- [ ] `scripts/release-package.sh` 自检通过（确认没有把内部编号带进包）

---

## T1402 e2e-flaky-auth

- 分支 / worktree：`fix/e2e-flaky-auth` → `../sass-e2e-flaky-auth`
- 依赖：—
- 依据：T1211 报告（含 trace 与 main 自身 CI annotation 的对照）

**问题**

`e2e/auth.spec.ts:157`「从用户菜单退出登录后不能再访问 dashboard」在 CI（生产构建）上间歇性失败，被记为 `1 flaky`（重试后过）。T1211 的定位：

- `e2e/auth-helpers.ts:131-144` 的 `openUserMenu`：移动端分支里，若用户菜单触发器不可见就先点 `Toggle sidebar`，然后点触发器、期待菜单出现 —— 整段包在 `toPass({ timeout: 10_000 })` 里。
- trace 显示：跳到 `/dashboard` 后约 200ms 就点了 `Toggle sidebar`，此时 **React 还没 hydrate，点击是空操作**；接着 `getByRole("button", { name: userMenu.open }).click()` 的**默认 action timeout 是 30 秒**，直接把 `toPass` 的 10 秒预算耗尽 —— 于是整段不再重试、直接失败。

**做**

二选一（说明理由）：

1. 让循环内的点击带**有界**超时（例如 `.click({ timeout: 1000 })`），这样单轮失败得快、`toPass` 能继续重试；或
2. 显式等 hydration 完成再点（例如等一个只在 hydrate 后出现的标记/属性，或先 `await expect(trigger).toBeVisible()` 再点）。

**不做**：放宽成 `toPass` 超时或加 `test.slow()` 掩掉症状；改断言本身。

**验收**

- [ ] 生产构建下连续跑 `e2e/auth.spec.ts` ≥10 次全绿（把命令与结果贴进 PR；本地可用 `CI=1` + `pnpm build && pnpm start`，端口自选）
- [ ] CI 上该用例不再出现 flaky 记录（合入后观察若干次 main 的 e2e）
- [ ] 改动只在 `e2e/auth-helpers.ts`（必要时 `e2e/auth.spec.ts`），不碰产品代码
