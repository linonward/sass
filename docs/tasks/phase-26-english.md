# 阶段 26：交付内容英文化

阶段完成后：发行包里的**代码注释、测试标题、运行时字符串（报错 / 日志 / 脚本输出）和买家文档全部是英文**；界面文案仍按语言走 `messages/*.json`，中文界面照常保留。CI 挡住中文重新混进随包文件。

依据：2026-09-30 定，目标用户从「中文独立开发者」改为**面向全球的独立开发者**（中文开发者仍是其中一群，靠中文界面和中文渠道覆盖，不靠中文文档）。评估时的盘点：766 个受版本控制的文件里 610 个含中文；其中随包的有买家文档约 1950 行、`src/core` 注释约 3000 行、测试标题约 1000 个、运行时字符串约 200 处。

## 为什么必须在 T2306 之前做完

- **升级通道**：买家靠差量更新包 + 三路合并升级（`UPGRADING.md`）。首单交付之后再整体换注释，这次更新会碰几百个文件，买家改过的每个文件都可能冒出纯注释的合并冲突，没有任何功能收益。现在还没有买家，这是改动成本最低的时刻；错过了就基本只能永远不改。
- **自验对象**：T2306 是作者只凭发行包、只读包内文档走一遍买家路径。要验的是最终交付的英文文档，不是即将被替换的中文版。

所以本阶段排在 T2305 之后、T2306 之前：T2306 的依赖改为 T2606。

## 边界

| 类别                                                                                                                                                   | 处理                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 随包的代码注释、测试标题、报错 / 日志 / 脚本输出、配置文件里的说明                                                                                     | 改英文                                                             |
| 随包的买家文档（README、UPGRADING、`docs/` 下随包的五份、NOTICES）                                                                                     | 改英文，**只留英文一份**，不做中英双份（一个人维护两份迟早不一致） |
| 界面文案（`messages/zh.json`）、中文 locale 的内容与测它的断言                                                                                         | 不动 —— 这是产品功能，不是开发语言                                 |
| 不随包的内部文档（`docs/plan.md`、`docs/tasks/**`、`docs/workflow.md`、`docs/go-to-market.md`、`docs/competitive-landscape.md`、`AGENTS.md`）、PR 标题 | 保持中文，不翻译                                                   |

随包 / 不随包以 `scripts/release-package.sh` 的 `exclude_paths` 为唯一口径。

## 本阶段的共同约束

- **只翻译，不改行为。** 每个 PR 除了注释、字符串和测试标题之外不动代码。纯注释的文件用「去掉注释后的输出一致」机械证明（例如用 `typescript` 的 printer 以 `removeComments: true` 分别打印改前改后再比较）；动了字符串的文件，靠单测 / e2e 的断言同步修改来证明。
- **意思照译，不缩水。** 这里的注释大多在解释取舍（为什么不用 X、踩过什么坑），翻译要保住「为什么」；机翻初稿必须逐段人工核对。确实冗余的可以顺手删，但不借翻译重写逻辑说明。
- **用户能看到的字符串不硬编码英文。** 如果翻译时发现某条中文报错其实会显示在界面上，它应该走 `messages/*.json`，不是换成英文硬编码 —— 这类发现记进 PR 描述，改动量小就在本 PR 修，大就另开卡。
- **术语与代码里的标识符对齐。** 以现有命名为准：积分 → credits、积分流水 → credit transactions、服务商 → provider、发行包 → release package、差量更新包 → update package、核对 → reconcile、买家 → buyer。拿不准的先 grep 标识符。美式拼写。
- **随包文件不引用任务卡**（阶段 23 的约束不变）：翻译时顺手确认没有 `Txxxx` 和指向不随包文件的链接。
- **每批一个分支 / worktree / PR**，按目录切，互不碰同一批文件。每个 PR 跑 `pnpm lint`、`pnpm typecheck`、`pnpm test`；动到 e2e 或 UI 字符串的加跑 `npx playwright test e2e/ui-shell.spec.ts e2e/landing.spec.ts` 和相关套件。

## 顺序

`T2600 → T2601 → T2602 → T2603 → T2604 → T2605 → T2606 → T2306`

T2601–T2605 按目录互不重叠，理论上可以并行；单人推进时串行做，最后由 T2606 加闸。

与[阶段 25（基础组件）](phase-25-foundation-components.md)的关系：两个阶段互不依赖。T2600 合入之后，阶段 25 新写的代码直接用英文（`AGENTS.md` 的语言规则）；阶段 25 的卡改到的目录如果正好在某个英文化批次里，后合入的那个 rebase 时顺手把对方新增的中文补译。

---

## T2600 english-plan

- 分支 / worktree：`docs/english-plan` → `../sass-english-plan`
- 依赖：—

**问题**

阶段 23 把目标用户固定为中文独立开发者，`docs/go-to-market.md` 把英文文档列为「评估后决定」。产品定位改为面向全球之后，交付内容的语言需要落成规则和任务，并插进首单交付之前。

**做**

- 新建本阶段文档，落 T2600–T2606。
- `AGENTS.md` 加语言规则：随包内容用英文，内部文档保持中文。
- `docs/tasks/phase-23-delivery.md`、`docs/plan.md`、`docs/go-to-market.md`：目标用户改为面向全球；英文化从「待评估」改为本阶段；T2306 依赖改为 T2606。
- `docs/tasks/README.md`：总览、依赖图、推荐顺序、阶段列表同步。

**验收**

- [x] 仓库文档里的目标用户描述一致（已完成任务卡里的历史表述不改）
- [x] T2306 的依赖在任务表与阶段 23 两处一致
- [x] `pnpm format:check` 绿

---

## T2601 english-core-billing

- 分支 / worktree：`chore/english-core-billing` → `../sass-english-core-billing`
- 依赖：T2600

**范围**：`src/core/billing`、`src/core/credits`、`src/core/ai`、`src/core/exceptions`、`src/core/recovery`（约 1650 行含中文）。

收费与恢复链路的注释最密、最讲取舍，先做，趁对这部分记忆最新。

**验收**

- [x] 范围内文件不含中文（`zh` locale 的测试夹具除外，并在 PR 描述列出）—— 实际没有例外
- [x] 纯注释文件去注释后的输出与改前一致：69 个源码文件去注释后一致；37 个测试文件去注释、并清空字符串内容后一致（只改了测试标题、`test.each` 标签和跳过提示）
- [x] `pnpm lint` / `pnpm typecheck` / `pnpm test` 绿（141 个文件，1599 项）

---

## T2602 english-core-identity

- 分支 / worktree：`chore/english-core-identity` → `../sass-english-core-identity`
- 依赖：T2601

**范围**：`src/core/auth`、`src/core/email`、`src/core/acquisition`、`src/core/admin`、`src/core/api-keys`、`src/core/security`、`src/core/ratelimit`、`src/core/account`、`src/core/db`、`src/core/config`（约 1800 行）。

`src/core/config/sentinels.ts` 的上线前占位提示、`src/core/db/client.ts` 的报错这类会打到终端的字符串在这一批，改完核对对应单测的断言。

**验收**：同 T2601。

---

## T2603 english-core-rest

- 分支 / worktree：`chore/english-core-rest` → `../sass-english-core-rest`
- 依赖：T2602

**范围**：`src/core` 下其余全部（status、observability、ui、upload、seo、blog、theme、changelog、i18n、flags、dashboard、marketing、onboarding，以及 `src/core` 根目录的文件，约 1300 行）。

**验收**：同 T2601，另跑 UI 的两套 e2e。

---

## T2604 english-app

- 分支 / worktree：`chore/english-app` → `../sass-english-app`
- 依赖：T2603

**范围**：`src/app`、`src/features`、`src/` 下 `core` 以外的其余文件、`e2e/`、`scripts/`、`.github/`、根目录配置（`site.config.ts`、`.env.example`、`next.config.ts`、`content-collections.ts`、`pnpm-workspace.yaml`、`vitest.config.mts`、`playwright.config.ts`、`eslint.config.mjs`、`commitlint.config.mjs`、`lint-staged.config.mjs`）、`content/legal`（约 1900 行）。

`site.config.ts` 和 `.env.example` 是买家最先打开的两个文件，说明要写得能独立读懂。`e2e/` 里断言中文界面的用例保留中文期望值，只改测试标题和注释。

**验收**：同 T2601，另跑完整 e2e（`docs/workflow.md` 那组环境变量整组照抄）。

---

## T2605 english-docs

- 分支 / worktree：`docs/english-docs` → `../sass-english-docs`
- 依赖：T2604（文档里引用的脚本输出和配置说明以英文版为准）

**范围**：`README.md`、`UPGRADING.md`、`docs/starter-guide.md`、`docs/agent-guide.md`、`docs/design.md`、`docs/i18n.md`、`docs/billing.md`、`THIRD-PARTY-NOTICES.md`。

- 直接替换为英文，不保留中文版。
- 锚点会变（例如 README 里的 `#10-分钟从零到上线`）：全仓 grep 旧锚点，包括代码注释和 UI 里指向文档的链接。
- `docs/agent-guide.md` 是买家的 AI 编码助手读的指引，补一句「代码、注释和文档用英文」，让买家项目沿用同一规则。

**验收**

- [ ] 范围内文件不含中文（示例里展示中文界面的片段除外）
- [ ] 随包文档之间、代码指向文档的链接和锚点全部可达
- [ ] `pnpm format:check` 绿

---

## T2606 english-guard

- 分支 / worktree：`chore/english-guard` → `../sass-english-guard`
- 依赖：T2605

**问题**

没有闸的话，后续每个 PR 都可能把中文注释带回随包文件。

**做**

- 加一个检查脚本（挂成 `pnpm` 命令并进 CI 的 `static` job）：扫描**随包文件集合**（与 `scripts/release-package.sh` 的排除清单同源，不另写一份），发现汉字即失败，输出文件和行号。
- 白名单尽量窄：`messages/zh.json`、中文 locale 的内容目录、以及显式标注的行（例如断言中文界面的 e2e 期望值）。标注方式在脚本开头说明。
- 对脚本本身写单测：随包文件里的中文会被抓到、白名单生效、不随包的文件不扫。
- `docs/workflow.md` 的提交前检查补上这一条。

**验收**

- [ ] 在 `main` 上跑通过
- [ ] 往任意随包 `.ts` 文件加一行中文注释，检查失败并指出位置
- [ ] CI 汇总闸门 `ci` 覆盖这一步
