# 阶段 23：交付与恢复（可交付版）

阶段完成后：**只拿发行包、只读包里的文档**就能部署一个有具体用途的 AI 工具，跑通付款 → 积分到账 → 生成 → 失败退款；关掉页面后生成任务仍被处理；买家改过业务之后，能成功接收一次模板更新。

依据：2026-09-29 的交付计划（三代：交付基础 / 收费业务的恢复能力 / 真实交付）。目标用户固定为**使用 Next.js、需要积分收费的独立开发者**（2026-09-30 由「中文独立开发者」改为面向全球，交付内容英文化见[阶段 26](phase-26-english.md)，排在 T2306 之前）；本轮**暂停扩充通用功能** —— 多租户、SSO、更多支付商、更多模型、多套主题、完整营销自动化、AI 成本分析都不在范围内。

## 批次

- **批次 A（交付基础，3–4 天）**：T2300 落卡 → T2301 模板升级 → T2302 买家 agent 指引。
- **批次 B（收费业务的恢复能力，5–7 天）**：T2303 AI 任务恢复 → T2304 计费异常台 → T2305 通知恢复。
- **批次 C（真实交付，3–4 天）**：T2306 参考产品（作者按买家路径自验）→ T2307 候选发行包 → T2308 首单放行。

顺序固定：`T2300 → T2301 → T2302 → T2303 → T2304 → T2305 →（阶段 26：T2600–T2606）→ T2306 → T2307 → T2308`，依赖合入后再开下一个。

批次 A 通过之前，对外**不承诺「支持持续升级」**；批次 C 通过之前，**不交付第一份发行包**。

**没有外部试用环节**（2026-09-30 定，见 T2310）：模板是数字产品，一旦交付就无法回收，首批买家拿到的就是正式版本，不能把他们当试用者。原先「交给外部试用者再发现问题」的验证，全部前移到首单交付之前，由作者只凭发行包自己走一遍（T2306）；交付后发现的问题只能靠差量更新包修，所以升级通道必须在首单之前演练过（T2307）。

## 本阶段的共同约束

- **不引入第二种语言或运行时**，也不引入独立的消息队列 / 工作流服务。恢复靠「Postgres + 一个受保护的 HTTP 入口 + 任何调度器都能调它」实现，触发频率的差异由部署方式决定（见 T2303）。
- **超时只表示需要核对，不等于失败。** 任何一处「等太久了所以判失败并退款」都是错的：先去供应商侧核对，能拿到结果就先保存结果。这条同时适用于 AI 任务和 webhook 补单。
- **随包交付的文件不能引用任务卡，也不能指向未随包交付的文件**（`docs/plan.md`、`docs/tasks/**`、`docs/workflow.md`、`AGENTS.md`、`CLAUDE.md` 都不在包里）。`scripts/release-package.sh` 的排除清单是唯一口径；新增/修改随包文件时同步看它，别让文档指向买家拿不到的东西。
- **每个任务一个分支 / 一个 worktree / 一个 PR**。UI 改动跑规定的单测与 UI e2e；涉及迁移和计费的任务另加数据库验证（真库，不是 mock）。
- **结算类改动必须同时检查三处状态**：订单（`orders`）、任务（`ai_usage`）、积分流水（`credit_transactions`）。页面提示、日志和返回值都不算证据。

## 五种必须实测的结算场景

批次 B 的三个任务共用这组场景，每个场景都要在真库上跑，并给出三处状态的对照（订单 / 任务 / 流水）：

1. **webhook 重复或乱序到达**：同一事件推两次、退款先于付款到达。
2. **两个请求同时结算同一任务**：客户端轮询与恢复扫描撞在同一个 `ai_usage` 行上。
3. **模型调用成功、本地保存失败**：供应商侧已经出结果，本地写库/R2 失败。
4. **退款事务遇到短暂的数据库故障**：退款与状态更新在同一事务，失败后可重来且不双退。
5. **用户离开页面后任务完成**：关掉标签页、换设备、进程重启（重新部署）之后回来。

## 需要的外部输入

工程准备可以先推进，但下面两件事只有你能提供，且都是**阻塞项**（卡在 T2306 / T2307 上）：

- 发行主体与支持邮箱（`LICENSE` 的方括号占位、上线清单里的支持范围）。
- 四家支付商（Creem / Stripe / Lemon Squeezy / Waffo Pancake）与模型服务商的**测试环境账号**，用来把真实测试环境的验证结果写进 T2307。卖家站点实际收款用 Waffo，它必须验证；其余三家未验证的在支持范围里标注。

## 明确不修 / 待定

- **多租户 / SSO / 更多支付商 / 更多模型 / 多套主题 / 完整营销自动化 / AI 成本分析**：本轮不做（阶段性收缩，不是永久决定）。
  - **例外**：Waffo（T2309）按 2026-09-29 的决定插在 T2306 之前接入，只做默认的 PSP 模式；其它支付商仍不在本轮。
- **提交幂等（双击重复扣费）**：T2303 **不做**。现在没有提交幂等键，双击会创建两条 `ai_usage` 并扣两次分。本阶段也不做「重复提交检测」—— 没有可靠判据（用户确实可以合法地连续提交两次相同输入），猜出来的判据会把正常用户判成异常。记在这里，等真实工单再说。
- **`aborted` 状态**：`ai_usage.status` 已经有这个取值，但没有代码写入它。本阶段不清理，等有人在恢复扫描里需要它时再说。
- **`docs/go-to-market.md` 的定价与渠道**：本阶段只修事实错误（见 T2300），不改价格与渠道计划。

---

## T2300 delivery-plan

- 分支 / worktree：`docs/delivery-plan` → `../sass-delivery-plan`
- 依赖：—

**问题**

阶段 23 的方案只在对话里，仓库里没有对应任务卡；同时 `docs/plan.md`、`docs/go-to-market.md`、`docs/competitive-landscape.md` 里有几处描述与当前实现不符，还有几处「市场唯一 / 空白」这类没有证据的结论。

**做**

- 新增本文件（阶段 23 的九张卡）。
- `docs/tasks/README.md`：总览表、依赖图、推荐顺序、任务详情四处补上阶段 23。
- `docs/plan.md`：状态行的阶段进度（1–22 已落地、23 进行中）；支付一行改成三个适配器（Creem / Stripe / Lemon Squeezy）；「v1 不做」里去掉已经实现的 Stripe 适配器，并把「队列与定时任务」改成「独立队列服务（定时触发只用于恢复核对）」；「推迟项」里那条 Stripe 的说明标注为已实现；「外部依赖」表补上阶段 23 需要的账号；风险那行「用 lint 规则标记业务项目对 `src/core` 的改动」与现状不符（实际是 `UPGRADING.md` + `scripts/core-drift.sh`），照实改。
- `docs/go-to-market.md`：删掉「功能组合是市场空白」「我们是唯一的选择」这类结论，改成按功能矩阵陈述并标注抽查时点；上线前缺口表里 Stripe 那一行已经过时（三个适配器都在），改成实际要做的事 —— 补一条「买家升级路径」（T2301）；把「实际测一次上手时间」指到 T2308；时间线按本阶段的三周重排，并把试用与放行条件写进这一节。
- `docs/competitive-landscape.md`：差异定位一节去掉「市场上没人同时做」的断言，改成「我们抽查到的产品里没有同时具备」（口径与时点写在段首）；功能矩阵里 Stripe 一行从「接口预留」改成已实现，多租户一行保持「v1 不做」；**「上游 git merge」一行改成待兑现**（zip 买家与模板没有共同 Git 历史，T2301 才解决）；劣势一节里「Stripe 适配器 v1 不做」改成「三个适配器的真实测试环境还没按买家流程验证过」；结尾那句「这套组合在市场上是空白的」删掉，改成有限的抽查结论。

**不做**

- 不改定价、渠道计划和目标用户画像（那是产品决策，本轮只修事实错误）。
- 不动 `docs/design.md`、`docs/i18n.md`、`docs/billing.md`（面向买家，本轮无事实错误）。
- 不新增引用任务卡的内容到随包交付的文件里。

**验收**

- [ ] 阶段 23 九个任务在本文件与 `docs/tasks/README.md` 里都能查到（ID、topic、分支、依赖、关系图）
- [ ] 三份文档里不再有「唯一 / 空白 / 没人做」这类无证据结论；保留下来的对照表述写明口径与时点
- [ ] `docs/plan.md` 的支付、v1 范围、推迟项与仓库现状一致（`grep` 得到的三处描述逐条核对过）
- [ ] `pnpm format:check` 绿

---

## T2301 template-upgrade

- 分支 / worktree：`chore/template-upgrade` → `../sass-template-upgrade`
- 依赖：T2300

**问题**

模板以 zip 交付，包里没有 `.git`，买家仓库与模板仓库**没有共同 Git 历史**：`README.md` 第 1 步和 `UPGRADING.md` 教的 `git merge upstream/main` 在买家那边只能靠 `--allow-unrelated-histories` 硬合 —— 第一次合并就是「两个不相干的树互相覆盖」，`git` 无法区分「买家改的」和「模板改的」，冲突要么满屏要么被静默覆盖。也没有任何东西记录买家手里这一份来自哪个版本。

**为什么不能用 `--allow-unrelated-histories` 收场**

它不是合并策略，只是关掉「历史不相干」这道保险。合并时模板的每一处改动都拿**空树**当共同祖先：模板删掉的文件不会删（买家那边看不出来）、买家改过的文件会被模板版本整份盖掉（除了 textual 冲突那几处），冲突结果与「谁改了什么」无关。买家想保留品牌、业务代码和业务迁移，全靠人工逐一比对。

**做**

1. **版本基线与清单（出包侧）**
   - 发行包里加一份机器可读的 `template.json`：`version`（git tag）、`ref`（commit sha）、`builtAt`，以及**每个随包文件的 sha256**（清单）。
   - `scripts/release-package.sh` 在 `git archive` 之后生成它（保持「只导出被跟踪文件」这条前提不变），并加一条自检：清单里不出现排除清单里的路径。
2. **差量更新包（出包侧）**
   - 出包脚本支持两个 ref：`scripts/release-package.sh --update v1.0.0 v1.1.0`，产出 `sass-template-update-<from>-<to>.zip`，内含：新版文件、**旧版同路径文件的副本**（三路合并的 base）、以及一份由脚本生成的变更清单（新增 / 修改 / 删除，逐文件列出）。
   - 更新包与主包用**同一套排除清单**（内部文档、卖家域名、`.env*` 一律不进），自检脚本同一份。
   - 迁移特例：`drizzle/**` 不走自动合并。买家自上个版本以来没动过迁移 → 直接应用模板新增的迁移；动过 → 停下并打印 `UPGRADING.md` 的迁移冲突处理步骤（重新生成本项目那条迁移），**绝不静默覆盖**。
3. **买家侧应用脚本**
   - 随包交付 `scripts/apply-template-update.sh`：校验买家 `template.json` 的 `version` 与更新包的 from 一致（不一致就拒绝，提示先补上中间版本）；逐文件三路合并（`git merge-file`：base = 旧版模板文件、ours = 买家当前文件、theirs = 新版模板文件）：
     - 买家文件哈希 == 旧版模板哈希 → 直接取新版；
     - 买家改过、模板也改过 → 尝试自动合并，合不上的**留下冲突标记并列出文件**，脚本以非零退出；
     - 模板删除的文件 → 只提示，不替买家删。
   - 结束时打印：改了哪些、冲突哪些、迁移要不要人工处理、需要跑哪些命令（`pnpm install` / `pnpm db:generate` / `pnpm test`）。合并结果落在工作区交给买家 review 后自己提交，脚本不碰 git 历史。
4. **两版本演练（验收的核心）**
   - 用仓库里两个**真实**提交做 from / to（不是专门造的玩具分支），在**全新克隆的买家仓库**上演练一次，覆盖四件事：买家改过品牌（`site.config.ts`）、文案（`messages/en.json`）、业务代码（`src/features/`）；买家与模板**双方都新增了迁移**；更新**不带回**卖家内部文档；冲突**不会被静默覆盖**（故意让同一个文件两边都改）。
5. **文档**
   - `UPGRADING.md` 重写为「先应用差量更新」为主路径，git 合并降级为「你有 git 历史且愿意自己合」的可选路径，并写清 `--allow-unrelated-histories` 为什么不是完整方案。
   - `README.md` 第 1 步与 `docs/starter-guide.md` 同步（买家拿到 zip 后怎么建立基线、怎么应用第一次更新）。
   - 随包交付的新文件里不得出现任务编号或未随包交付的路径。

**不做**

- **不改成「把模板 Git 历史打进包里」**：zip 里塞 git bundle 能让买家从模板的真实历史起步，升级就变成普通的 `git merge upstream/main`。但模板历史里带着内部文档与提交信息（任务编号、卖家计划），要交付就得先改写历史（`git filter-repo` 之类），本轮改动面太大；记在这里作为**下一轮的候选方案**。
- 不做自动化解冲突（语义冲突交给人）、不做回滚/卸载、不做「一键同步核心目录」（目录边界仍是买家自己的责任）。
- 不改 `scripts/core-drift.sh`（它服务的是 git 合并那条路径，保留）。

**验收**

- [ ] 全新买家仓库上完成一次 from → to 的升级，品牌、业务代码、业务迁移都保留
- [ ] 双方都加迁移时脚本停下并给出可执行的处理步骤，不覆盖任何一方
- [ ] 更新包里零命中内部文档、卖家域名与任务编号（自检脚本同一份）
- [ ] 冲突演练：故意两边改同一文件，脚本非零退出且工作区留下冲突标记与文件清单
- [ ] `README.md` / `UPGRADING.md` / `docs/starter-guide.md` 三处说法一致，且都不含未随包交付的路径
- [ ] `pnpm format:check` + 脚本自身冒烟（在仓库里跑一次 `--update`）

---

## T2302 buyer-agent-guide

- 分支 / worktree：`docs/buyer-agent-guide` → `../sass-buyer-agent-guide`
- 依赖：T2301

**问题**

买家拿到包以后**没有任何面向 AI agent 的说明**：`AGENTS.md` 被出包脚本排除（理由充分 —— 里面是模板作者的工作流），而买家大概率会用 Claude Code / Cursor 来写业务。结果 agent 只能自己猜：不知道 `src/core` 不能改、不知道业务代码放 `src/features/`、不知道改 schema 之后要先 `pnpm db:generate`、不知道 e2e 需要那一组环境变量（那组现在只写在**不随包交付**的 `docs/workflow.md` 里），于是一上手就踩目录边界和迁移这两条最容易造成后续升级冲突的线。

**做**

- 新增随包交付的买家 agent 指引（`docs/agent-guide.md`，或按结论改写为随包的 `AGENTS.md` —— 选哪个都行，但要处理 `next dev` 会**重新生成** `AGENTS.md` / `CLAUDE.md` 这件事，附一段说明，否则买家会以为文件被改坏了）。
- 内容至少覆盖：
  - **目录边界**：哪些目录归模板（`src/core`、`(marketing)`、`(admin)`、`api`）、哪些归业务（`features`、`(app)`、`site.config.ts`、`messages`、`content`），以及为什么（改了怎么影响下一次升级，指向 T2301 的升级流程）。
  - **加一个业务页面的完整步骤**：路由文件 → feature 模块 → 侧边栏菜单（`dashboard.nav`）→ 文案（`messages/*.json`）→ 单测 / e2e，每一步给可复制的命令与验证方式。
  - **数据库**：`pnpm db:generate` / `pnpm db:migrate` 的顺序、迁移编号撞车时怎么办（指到 `UPGRADING.md`）。
  - **测试**：`pnpm test` 与 `pnpm test:e2e` 的最小可用命令，包含 e2e 那组环境变量（从 `docs/workflow.md` 里搬一份**买家版**过去，只留买家需要的部分）。
  - **升级**：拿到新版更新包后该跑什么（指向 T2301 的脚本与 `UPGRADING.md`）。
- 出包脚本与自检同步：这条指引必须**在包里**；如果新文件落在 `docs/` 下，确认它不在排除清单里。
- 验收方式是**非作者走一遍**（可以由买不到的试用者或你自己换个全新目录、只读文档来跑）。

**不做**

- 不把模板作者的工作流（分支 / worktree / PR 规则、任务表）带进买家文档。
- 不做英文版（`docs/go-to-market.md` 里英文化仍是「评估后决定」）。
- 不为了写指引去改核心代码；指引里发现的核心缺口另开任务。

**验收**

- [ ] 从发行包出发，按指引添加一个业务页面，**不需要改 `src/core` 的任何文件**
- [ ] 指引随包交付，且不含任务编号与未随包交付的路径（出包自检零命中）
- [ ] 一个非作者（或换个全新目录、只按文档操作）能独立跑通「加页面 → 跑单测 → 跑 e2e」
- [ ] `pnpm format:check` 绿

---

## T2303 ai-job-recovery

- 分支 / worktree：`feat/ai-job-recovery` → `../sass-ai-job-recovery`
- 依赖：T2302

**问题**

**服务端没有任何东西会推进 AI 任务的状态，推进状态的是浏览器里的轮询。**

- 视频：`startVideo` 在一个事务里插入 `ai_usage`（`status='pending'`）并预扣积分，然后调供应商拿 `taskId` 写进 `operation`；之后**只有**客户端轮询 `GET /api/ai/video/<id>` 才会去问供应商、下载视频、写 `files` 并结算（`settleUsage`）。
- 因此：用户关掉标签页 → 轮询停 → 那一行**永远停在 `pending`**，积分**一直扣着**，视频明明在供应商侧已经生成好了也拿不到。
- 30 分钟的超时（`VIDEO_TIMEOUT_MS`）**只在有人轮询时才被计算** —— 用户不回来，超时永不触发。
- 文本：`consumeStream()` + `after()` 只在函数存活期间兜住结算（chat 路由 `maxDuration` 60 秒）；函数被回收就只剩一行 `pending`。
- 异常全是"看不见"的：后台只有聚合的调用次数与失败率，没有「挂太久的任务」列表。

**做**

1. **一个恢复入口，多个触发源**
   - 新增受保护的内部入口（如 `GET /api/cron/recovery`）：校验 `CRON_SECRET`（Vercel 的 cron 会带 `Authorization: Bearer $CRON_SECRET`；自托管用任何调度器 curl 同一路径，带同一个头）。
   - **默认对 Hobby 可用**：Vercel 的 Hobby 套餐**只允许每天跑一次** cron，超过每天一次的表达式会**部署失败**（官方文档：Usage & Pricing for Cron Jobs）——所以不能假设买家有按分钟级的 cron。设计成：
     - 入口本身与触发频率解耦，谁调都行；
     - **机会式扫描**：用户发起 AI 请求或打开相关页面时，如果距上次扫描超过 N 分钟，就跑一次**有界**扫描（一次处理固定条数上限），用数据库里的时间戳/锁避免并发重复扫描；
     - 文档写给三种部署：Vercel Pro（每分钟 cron）、Vercel Hobby（每天一次 cron + 机会式）、自托管（系统 cron / systemd timer / Docker 里的调度器）。
2. **扫描逻辑：先核对，再判定**
   - 取 `status='pending'` 且 `createdAt` 早于阈值的行，按 `kind` 分流：
     - **有 `taskId` 的视频**：查供应商状态 → 成功就下载入库并结算成功（复用现有 `pollVideo` 的结算路径，**不要**新写一条）；供应商明确失败 → 结算失败并退款；仍 pending 且未到硬上限 → 留着，下次再看；超过硬上限 → 结算为失败并退款，错误信息写明「供应商侧长期无结果」。
     - **没有 `taskId` 的**（进程在拿到 taskId 之前就死了）：核对供应商侧是否有该任务；拿不到就等硬上限后结算失败并退款。
     - **文本 / 图片**：按同样的阈值核对（它们的结算在同一次请求内完成，正常不会留下 pending）。
   - **超时 ≠ 失败**：任何情况下都先核对供应商，能拿到结果就**先保存结果**，不许直接退款了事。
3. **幂等**
   - 扫描与客户端轮询会同时结算同一行：复用 `settleUsage` 的 `onlyIfPending` 守卫与退款幂等（`credit_transactions` 的 `(source, sourceId)` 唯一），保证**只结算一次、只退一次**。
   - 扫描本身可重入：同一批任务跑两次结果相同。
4. **可见性**
   - 扫描每次记一条结构化日志（`ai.recovery`），带上扫描条数、结算成功/失败/仍挂起的计数；异常清单本身由 T2304 提供。
5. **文档与配置**
   - `.env.example`、`README.md`（上线清单）写 `CRON_SECRET`：不设时入口一律 404/401（明确拒绝，不静默放行）；Vercel 上对应的 cron 配置写进 `vercel.json`（**默认注释或按每天一次**，买家按自己的套餐改）。

**不做**

- **不引入独立队列 / 工作流服务**（Inngest / QStash / BullMQ 之类），也不把结算搬到「后台 worker」。买家买的是一个 Vercel + Neon 就能跑的东西。
- **不做提交幂等**（双击重复扣费）：记录在案，见本文件「明确不修」一节。
- 不改视频供应商的调用方式、不改前端轮询（前端轮询保留，恢复扫描是它的兜底，不是替代）。
- 不改 30 分钟这个阈值语义以外的时间常量（`VIDEO_TIMEOUT_MS` 保留，新增的是**扫描**用的阈值与硬上限）。

**验收**

- [ ] 关掉页面后任务仍被处理：提交视频 → 关闭所有页面 → 只让扫描跑 → 任务完成、视频在历史里、积分正确
- [ ] 进程重启（模拟重新部署）后，遗留的 `pending` 仍被扫到并处理
- [ ] 场景 3（供应商成功、本地保存失败）：扫描先核对再保存结果，**不退款**
- [ ] 场景 5（用户离开页面）：见上一条
- [ ] 并发：客户端轮询与扫描同时结算同一行 → 只结算一次、只退一次（DB 测试断言三处状态）
- [ ] 供应商长期无结果 → 到硬上限后结算失败并退款，`error` 写明原因
- [ ] 入口在没有正确 `Authorization` 头时拒绝请求（401/404），有正确头时可用
- [ ] README / 上线清单 / `.env.example` 写明 `CRON_SECRET` 与三种部署方式的触发配置
- [ ] `pnpm test` + 相关 e2e 全绿；迁移（若新增列/表）走 `pnpm db:generate` + `pnpm migrations:check`

---

## T2304 billing-exceptions

- 分支 / worktree：`feat/billing-exceptions` → `../sass-billing-exceptions`
- 依赖：T2303

**问题**

钱出问题的时候，**没有地方能看见，也没有地方能处理**：

- **退款回收差额只在日志里。** 用户把积分花掉之后退款，`reclaimCredits` 封顶在余额，差额只打一行 `billing.refund_reclaim_shortfall` 日志 —— 不落表、后台查不到、事后没人知道谁欠着。推荐返利那边已经有 `referral_reward_debt` 表可以做这件事，计费侧没有。
- **AI 任务同样没有「待核对」的位置。** `ai_usage` 只记录任务自身的结果，没有「供应商侧可能有结果、我们还没核对」这个状态。T2303 的扫描能自动处理绝大多数，但**扫描自己失败**（查供应商报错，既不能判成功也不能判失败）和**到硬上限先退款、供应商后来才成功**这两种情况，需要一个有人看的地方。
- **后台只有聚合指标，没有任何可执行的动作。** `/admin/metrics` 是只读的调用次数与失败率；没有任何入口能「再试一次回收」「重新核对这个任务」。
- **处理过程无处留痕。** 后台动作里只有积分调整留了 `actor_id`，封禁/解封落在 Better Auth 的表上；异常处理如果不额外记一笔，事后无法回答「谁在什么时候对哪一条做了什么、为什么」。

**做**

1. **异常单表**（`billing_exceptions`，迁移编号按当时的 `pnpm db:generate` 结果，别照抄这里）
   - 字段：`id`、`kind`、`user_id`、`source` / `source_id`（指向订单 / `ai_usage` 行 / 回收动作）、`status`（`open` / `resolved` / `ignored`）、`detail`（jsonb，放上下文快照：订单金额、已回收、差额、任务 id、供应商状态）、`attempts`、`lastError`、`created_at` / `updated_at` / `resolved_at`、`resolution`（处理说明）。
   - 唯一键挡住重复开单：`(kind, source, source_id)` —— 事件重放、扫描重跑都不能开出第二张。
   - `kind` 先落两个取值，留扩展位：`refund_reclaim_shortfall`、`ai_job_needs_review`。
2. **在正确的地方开单**（不改动任何金额计算）
   - **回收差额**：`reclaim-credits.ts` 的 shortfall 分支里，除现有日志外，在**同一事务内**写一张 `refund_reclaim_shortfall`（detail 记订单号、授予额度、已回收、本次差额）。日志保留。
   - **AI 任务需要人工核对**：两处 —— 扫描查供应商报错（既不能判成功也不能判失败）时开 `ai_job_needs_review`；扫描到硬上限、按「无结果」结算失败并退款时也开一张（防止供应商侧其实成功而我们已退款，需要人判断追回还是补发）。
   - T2305 若发现「永久失败的通知」也需要进驻，同一张表加一个 `kind`，不要把失败静默掉。
3. **后台异常列表 `/admin/exceptions`**
   - 列表：按 `kind` / `status` 过滤 + 分页；每行显示用户、金额/任务摘要、开出时间、尝试次数、最后一次错误。
   - 行内可跳转：订单（`/admin/orders`）、用户（`/admin/users/<id>`）、该用户的积分流水 —— 保证「能查」。
   - 侧边栏入口带未处理计数（`open` 数量），让异常不会被放着没人发现。
4. **受权限保护的处理动作**（Server Action，每个都**复用已有幂等路径**，不新写金额逻辑）
   - `refund_reclaim_shortfall` → **重试回收**：调 `reclaimCredits`（它自带行锁与幂等），成功则关单，余额仍不够则留在 `open` 并累加 `attempts`；另有 **标记已处理**（写 `resolution`，状态置 `resolved` 或 `ignored`）。
   - `ai_job_needs_review` → **重新核对**：再查一次供应商，有结果就按 T2303 的结算路径保存（复用 `settleUsage` 的 `onlyIfPending`）；确实无结果就标记已处理。
   - 所有动作：先 `requireAdmin()`（沿用现有 `getAdminSession()` 的缓存与 404 语义），Server Action 内**再验一次**权限；全部要填理由。
   - **幂等**：重复点击不重复扣款/退款。实现前先读 `credits/service.ts` 的 `reclaimCredits` 与 `reclaim-credits.ts` 现在的 `(source, source_id)` 取值规则，把「这次重试与上一次的幂等键如何区分 / 如何不区分」写进 PR 说明 —— **不要凭印象加新的幂等键**（多写一个键就是多一次扣款的机会）。
5. **处理留痕**：新增最小的 `admin_actions` 审计表 —— `actor_id`、`action`、`target_kind` / `target_id`、`reason`、`result`、`created_at`；异常台的每个动作写入一行，异常单行内显示处理历史。
6. **文档**：README 的后台一节补上异常列表；`.env.example` 预计不新增变量。

**不做**

- **不追溯补历史差额**：本卡之前产生的 shortfall 只在日志里，不回填（写在这里，免得以后有人以为漏了）。
- 不做对账报表 / 财务导出 / BI、不做自动催收（差额只记录与重试，不自动发信追讨）。
- 不改支付商侧的退款发起流程（退款仍在支付商后台发起，本卡处理回收与善后）。
- 不做批量操作（先一条一条处理）、不做异常自动关闭（必须有人写理由）。
- 不给封禁 / 解封补审计（那是 Better Auth 的表，另开卡再说），本卡只从异常台的动作开始记。

**验收**

- [ ] 场景 4（退款事务遇到短暂数据库故障）：重放 webhook / 重试后**只回收一次、只退一次、只开一张异常单**（DB 测试断言订单、流水与异常单三处）
- [ ] 场景 1（webhook 重复或乱序）：同一退款事件重复推送不产生第二张异常单
- [ ] 余额不足时回收产生差额单，`/admin/exceptions` 能看到并显示差额；余额后来够了，「重试回收」成功扣减并关单
- [ ] 重复点击「重试回收」只扣一次（断言流水条数与余额）
- [ ] 非管理员访问 `/admin/exceptions` 返回 404；直接调用处理动作被拒（沿用现有断言习惯）
- [ ] 每个处理动作都写入 `admin_actions`（actor、时间、目标、理由、结果），异常单行内可见处理历史
- [ ] 侧边栏显示未处理计数；`open` 清零后计数消失
- [ ] `pnpm test` + `pnpm migrations:check` + 后台相关 e2e（含 375px 不横向溢出）全绿

---

## T2305 notification-recovery

- 分支 / worktree：`feat/notification-recovery` → `../sass-notification-recovery`
- 依赖：T2303

**问题**

事务邮件的可靠性停在「进程活着的时候」：

- 计费类邮件（付款成功 / 付款失败 / 订阅取消 / 余额不足）有 `(kind, key)` 的 `notification_log` 去重 + 3 次指数退避重试，但**重试状态在内存里**（`src/core/email/delivery.ts`）：应用重启、函数被回收、或三次都失败之后，这封信就**永久丢了**（失败时释放去重名额，等着下次有人触发同一个事件 —— 而 webhook 重放会被 `webhook_events` 挡掉，所以通常没人再触发）。
- 更关键的是：**登录验证码与改邮箱验证码根本没走这套**（`src/core/auth/server.ts` 直接 `sendEmail`，失败只记日志并把错误抛给用户）。发信服务短暂不可用 = 用户**登不进去**，而且没有任何补发机制。
- 状态页通知、留资确认邮件同样没有持久化。
- 阶段 12 的 T1215 当时是**有意**选的这条路（释放去重名额而不是建 outbox）；本任务就是把当时的取舍补完。

**做**

1. **持久化的待发送记录（outbox）**
   - 新表（如 `pending_notifications`）：`kind`、`key`、`userId`、收件地址、模板与 props（`jsonb`）、`locale`、`status`（`pending` / `sending` / `sent` / `failed`）、`attempts`、`lastError`、`nextRetryAt`、`createdAt` / `updatedAt`，迁移走 `pnpm db:generate`。
   - 关键事务邮件改为「**事务内入队** → 提交后立即尝试一次发送」；`sendEmail` 的直接调用点按模板清单逐个迁过来（付款四件套 + 登录验证码 + 改邮箱验证码；状态页与留资先写清为什么不迁）。
   - 与现有 `(kind, key)` 去重的关系写清楚：去重名额**入队时**占，`sent` 之后保留（维持 at-most-once），`failed` 之后按现有规则释放，避免同一封信既被 outbox 补发又被事件重放再发一次。
2. **补发扫描**
   - 复用 T2303 的恢复入口（同一个受保护路径，或同一套调度逻辑）：扫 `status='pending'` 且 `nextRetryAt <= now()` 的行，按退避重试，超过上限记终态 `failed` 并保留（可人工补发），不再无限重试。
   - 幂等：同一行的多次扫描只发一次（发送前用状态转换抢占，或用 Resend 的幂等键 —— **先核对官方文档是否支持 `Idempotency-Key`**，支持则用行 id 作键，不支持就走状态抢占并写明）。
3. **用户可见的行为**
   - 验证码邮件入队失败时，用户看到的是明确的「稍后重试 / 用 Google 登录」，而不是一个 500；冷却时间与重发逻辑保持不变。
4. **文档**：README 的邮件一节改写为「入队 → 提交后发送 → 失败由扫描补发」，写明终态失败怎么查、怎么人工补发（不要求做后台页面 —— T2304 的异常列表如果有位置就放一起）。

**不做**

- **不引入消息队列 / 不引入 Redis 存队列**（沿用 Postgres）。
- 不改邮件模板内容、不改 `EMAIL_TRANSPORT` 的三种实现语义（`console` / `file` 照旧直接成功）。
- 不做营销邮件、不做群发、不做退订管理。
- 不把 `statusIncident` / 留资确认这类非关键邮件一并迁进来（写下理由即可）。

**验收**

- [ ] 发信服务不可用 → 记录留在库里；恢复后（或应用「重启」后）扫描把它发出去
- [ ] 应用重启后待发送通知仍可继续处理（测试里用新实例模拟：旧实例入队失败 → 新实例扫描补发）
- [ ] 重复扫描/重放不重复发：同一 `(kind, key)` 只发出一封（断言收件记录只有一条）
- [ ] 登录验证码入队失败时用户拿到明确提示，冷却结束后能重发成功
- [ ] 终态失败可查（日志或后台），并有一条人工补发的路径
- [ ] `pnpm test` + `pnpm migrations:check` 绿；README / `.env.example` 同步

---

## T2306 reference-product

- 分支 / worktree：`docs/reference-product` → `../sass-reference-product`（本仓库只落记录文档，产品代码在独立仓库）
- 依赖：T2305、T2606（自验的是英文化之后的发行包与文档，见阶段 26）、T2313（商品图作为生成输入）

**问题**

模板的复用能力没有被真实产品验证过：目录边界、升级流程、计费与 AI 的实际手感，都还只是设计意图。同时，模板自己也需要一个「按模板启动的样例」来暴露通用缺口。

没有外部试用（见阶段开头），这是**首单交付前唯一一次按买家路径的完整验证**：作者只拿发行包、只读包里的文档（README、`docs/starter-guide.md`、`docs/agent-guide.md`、`UPGRADING.md`），不看仓库、不翻任务卡、不凭记忆补步骤。

**做**

- 用模板（**按买家的路径**：发行包 + T2301 的升级流程）启动一个独立产品：**商品宣传图生成器** —— 上传商品图 → 生成宣传图 → 按次扣积分 → 查看历史结果 + 退款链路。
  - 业务代码全部落在 `src/features/` 与 `(app)` 路由，`src/core` 尽量不动；动了的地方**逐条记录**是缺配置、缺钩子还是真缺口。
  - 这个产品使用独立仓库，不并入本仓库。
- 本仓库只落 `docs/reference-product.md`：产品仓库地址、用到/没用到哪些模块、`src/core` 被改动的每一处及原因、按文档走不通的地方（这是 T2302 的输入）、以及模板侧的修复清单。
- 同时记录原先由试用者提供的四项：哪一步需要翻仓库或凭记忆才走得通（等同于「需要作者介入」）；首次部署耗时；首次成功收费耗时；按文档走不通、需要写进 FAQ 或支持范围的问题。
- 通用缺口**回到模板修**（另开任务或并入批次内任务），不要在产品仓库里打补丁绕过。
- 支付商在**真实测试环境**跑付款：Waffo Pancake 必须跑（卖家站点就用它收款），Creem / Stripe / Lemon Squeezy 有账号就各跑一次；验证结果记进 T2307（未验证的必须标注，**fake 的 e2e 通过不算**）。

**不做**

- 不做协作、复杂编辑器、模板市场这类额外产品需求（这个产品只用来验证模板）。
- 不把参考产品的业务代码放进模板仓库（否则买家会以为那是模板的一部分）。
- 不为这个产品改模板的默认配置（`site.config.ts` 在独立仓库里改）。

**验收**

- [ ] 只凭发行包与包内文档：注册 → 购买（真实测试环境，至少含 Waffo）→ 生成 → 历史记录 → 退款 全链路可实际操作
- [ ] 四项记录齐全；每处「需要翻仓库才走得通」都已补进包内文档
- [ ] 产品仓库里 `src/core` 的改动逐条有解释，能归因到「缺配置 / 缺钩子 / 真缺口」
- [ ] `docs/reference-product.md` 记录完整，且该文件**不进买家包**（出包脚本排除清单同步更新 + 自检断言）
- [ ] 模板侧发现的问题有对应任务或明确记录，没有在产品仓库里绕过

---

## T2307 release-candidate

- 分支 / worktree：`chore/release-candidate` → `../sass-release-candidate`
- 依赖：T2306

**问题**

还没有一个「可以发给买家」的候选发行版：没有版本号、没有变更说明、没有升级说明、支持范围没写、`LICENSE` 里还是方括号占位。

**做**

- **版本与发行物**：给 `main` 打第一个候选 tag（如 `v1.0.0-rc.1`），用它出包：包名带版本、`template.json` 记录 `version` / `ref` / `builtAt` / 文件清单（T2301 的产物）；同时产出变更说明（`CHANGELOG.md`，只写买家关心的变更，**不含内部编号**）与升级说明（`UPGRADING.md` 的差量更新流程）。
- **干净环境验证**：在干净目录/容器里解包，跑通 `pnpm install` → `pnpm test`（无 `.env.local` 时该跳过的会跳过，输出里要写明）→ `pnpm build`（最小 env）→ `scripts/release-package.sh` 自检；记录耗时与任何需要人工介入的步骤。
- **许可与支持范围**：`LICENSE` 的方括号占位替换为实际信息（**需要你提供**授权方名称、管辖法域与法院、联系邮箱）；README 写清支持范围（支持邮箱、响应时限、更新窗口，例如早鸟期 1 年免费更新 —— 与 `docs/go-to-market.md` 的说法一致）。
- **已知限制**：README 或 `UPGRADING.md` 里列出买家该知道的边界（v1 不做多租户、单栈 Node/TypeScript、Neon 专有特性、各支付商适配器的验证状态、恢复扫描的触发频率取决于套餐）。
- **升级通道演练**：交付后修问题只能靠差量更新包。用 `rc.1 → rc.2` 在 T2306 的产品仓库上真实跑一次 `scripts/apply-template-update.sh`，确认买家改过业务之后仍能收到更新；演练不通过不交付。
- **支付商验证记录**：四家（Creem / Stripe / Lemon Squeezy / Waffo Pancake）的真实测试环境验证结果逐条记录，未验证的**必须标注**；同时写清 mock 与 fake e2e 覆盖了什么、不覆盖什么。
- **出包自检补两条**：一是随包文件不得指向未随包交付的文档（当前已知一处：`e2e/email-change.spec.ts` 里的注释指向 `docs/plan.md`，一并修掉）；二是更新包与主包共用同一份排除清单。

**不做**

- 不写营销页素材、不做 Product Hunt 上线（那是 `docs/go-to-market.md` 里的事，且要等 T2308 放行）。
- 不做自动发版流水线（CI 出包、自动打 tag）—— 本轮先手工出包，把流程跑通再说。
- 不改功能代码；这个任务只做包装、验证与文档。

**验收**

- [ ] 干净环境里安装、测试、构建、出包自检全部通过，步骤与耗时记录在案
- [ ] 包里：`template.json` 有版本与清单、`CHANGELOG.md` 有买家可读的变更、`UPGRADING.md` 有升级说明
- [ ] `LICENSE` 占位全部替换；支持范围与已知限制写明
- [ ] 四家支付商的测试环境验证结果有记录，未验证的明确标注；Waffo 必须是已验证
- [ ] `rc.1 → rc.2` 差量更新在改过业务的产品仓库上跑通
- [ ] 随包文件不指向未随包交付的路径（自检新增断言零命中）

---

## T2308 sell-gate

- 分支 / worktree：`docs/sell-gate` → `../sass-sell-gate`
- 依赖：T2307

**问题**

交付不可回收：包一旦发给买家，里面的许可条款、泄露的内部内容、走不通的步骤都收不回来，只能靠之后的差量更新补。需要一道「首单交付前」的关卡，逐条确认发出去的东西站得住。

原先这张卡是「3 位外部开发者试用」，2026-09-30 取消（见阶段开头与 T2310）：没有免费试用，首批买家就是正式买家，不能拿他们来发现问题。

**做**

- 首单交付前逐条确认下面的放行条件，每条附证据（任务、记录文档、命令输出），结论落 `docs/sell-gate.md`（内部文档，不进买家包，出包排除清单同步）。
- 放行前，卖家站点的购买入口保持关闭：生产环境设 `SITE_HIDDEN_PLANS=lifetime`，交付卡片退回「即将公布」（T2404 的机制，不改代码）；全部放行后再去掉。已经收到的订单按首页承诺的 24 小时内交付，交付的必须是放行后的包。
- 问题清单：每条标阻塞 / 非阻塞、归属（文档 / 模板 / 外部服务）、处置（已修 / 排期 / 明确退出支持范围）。阻塞项要么解决、要么写进支持范围之外，不能留「不知道怎么办」的项。

**放行条件（首单交付前逐条确认）**

- [ ] 买家创建与升级路径均跑通（T2306 只凭发行包起步 + T2307 的 `rc.1 → rc.2` 升级演练）
- [ ] AI 异常不会无限期悬挂且无人发现（T2303 + T2304 的异常列表）
- [ ] 异常退款可以查询和处理（T2304）
- [ ] 发行版本、许可、交付权益与支持范围清楚（T2307）
- [ ] 作者按买家路径、仅凭发行包完成全流程的记录（T2306）

**不做**

- 不做外部试用、不发免费包、不做付费转化率优化与定价实验。
- 不因为个别需求改模板范围（记进问题清单，按归属处置）。

**验收**

- [ ] 放行条件五条逐条勾选并附证据，未满足的不放行
- [ ] 问题清单里所有阻塞项都已解决或明确退出支持范围
- [ ] `docs/sell-gate.md` 不进买家包（排除清单 + 自检断言）

---

## T2309 waffo-billing

- 分支 / worktree：`feat/waffo-billing` → `../sass-waffo-billing`
- 依赖：T2305（插在 T2306 之前，见「明确不修 / 待定」里的例外）

**问题**

买家要接 Waffo。Waffo 有两条产品线：面向开发者自助开通的 **Waffo Pancake**（pancake.waffo.ai，MoR，有产品目录）和企业签约的支付 API（dashboard.waffo.com，PSP）。按 2026-09-29 的决定接 **Pancake**（已有账号）。按 `docs/billing.md` 的「加第四个支付商」接入。

**做**

1. `providers/waffo.ts`：官方 SDK `@waffo/pancake-ts`（MIT、零依赖）。`checkout.authenticated.create`（`buyerIdentity` = 用户 ID，`metadata` 带回 userId / planId）；订单 = Pancake 的一笔付款（`paymentId`），退款按被退的那笔对上；订阅 ID = 订阅单的 `orderId`；门户返回托管门户登录页（官方没有预登录链接）；删号取消用 `orders.cancelSubscription`（用到期末），已结束的视为成功。
2. 事件映射写在 adapter 顶部；幂等键「事件类型 + eventId」；webhook 固定按 `WAFFO_MODE` 的环境验签并核对 `mode`（生产拒收测试事件）。
3. 注册：`billingProviderNames`、`billingServerEnv`（`WAFFO_MERCHANT_ID` / `WAFFO_PRIVATE_KEY` / `WAFFO_MODE`）、`createProvider()`、`/api/webhooks/waffo`、`productIdEnvPrefix`（`WAFFO_PRODUCT_ID_*`）；`WAFFO_MODE=prod` 加进 fake 硬锁。
4. 测试：真实 SDK + 注入的 fetch，本地生成密钥按 Pancake 的格式签 webhook。
5. 文档：README 上线清单、`docs/billing.md`（**提现只到大陆人民币账户、税费代收未开启**）、`.env.example`、`THIRD-PARTY-NOTICES.md`。

**不做**

- 套餐升降级（plan_change）、站内发起退款、自建客户自助界面（用托管门户）。
- 真实测试环境验证等 Test API Key 就绪后补（记进 T2307），**单测通过不算真实验证**。

**验收**

- [ ] `BILLING_PROVIDER=waffo` + Test Key：一次性购买与订阅都能跳到 Pancake 收银台，webhook 到账后三张表正确（Key 就绪后验证）
- [ ] webhook 验签失败 / 环境不符返回 401
- [ ] 事件映射覆盖：付款成功、订阅激活 / 续期 / 取消 / 终止 / 欠费、部分 / 全额退款
- [ ] 其它三家服务商的单测与 e2e 不受影响
- [ ] `pnpm test` / `pnpm notices:check` 绿；README / billing.md / .env.example 同步

---

## T2310 delivery-gate

- 分支 / worktree：`docs/delivery-gate` → `../sass-delivery-gate`
- 依赖：T2407

**问题**

T2407 让首页可以直接下单，但阶段 23 仍按「T2308 外部试用 → 正式售卖」的顺序写。模板是数字产品，交付不可回收，也不做试用：首批买家不能充当试用者，交付后才发现的问题只能靠差量更新补。文档的顺序与放行条件需要按这个事实改。

**做**

- 阶段开头：去掉试用，写明「批次 C 通过之前不交付第一份发行包」及理由；外部输入删掉试用用户，支付商补上 Waffo。
- T2306：改为首单交付前的作者自验，只凭发行包与包内文档，并接手原试用的四项记录。
- T2307：支付商验证改四家（Waffo 必须验证）；新增 `rc.1 → rc.2` 升级演练。
- T2308：改为 `sell-gate`（首单放行关卡），第五条放行条件改为「作者按买家路径、仅凭发行包完成全流程的记录」；放行前用 `SITE_HIDDEN_PLANS` 关闭购买入口。
- `docs/tasks/README.md`、`docs/plan.md`、`docs/go-to-market.md` 同步。

**验收**

- [x] 仓库文档里不再有外部试用 / 试用用户作为待办或放行条件（已完成任务卡里的历史表述不改）
- [x] 五条放行条件在 phase-23、go-to-market 两处一致
- [x] `pnpm format:check` 绿

---

## T2311 merge-hygiene

- 分支 / worktree：`docs/merge-hygiene` → `../sass-merge-hygiene`
- 依赖：—

**问题**

多个 worktree 并行时，PR 基于旧 `main` 开出、合入时不重跑 CI，冲突与语义冲突都靠运气；squash 合并没写 `--subject`，`main` 上的提交丢了任务 ID（#169、#171）；`docs/workflow.md` 写着要开分支保护，实际 `main` 没有保护。

**做**

- `docs/workflow.md`：开 PR 前与合入前 rebase 到 `origin/main` 及原因；合并命令固定 `--subject "<PR 标题>"`；清理用 `git branch -D`（squash 后 `-d` 会拒绝）；「GitHub 仓库设置」按实际生效的保护规则重写，附核对命令。
- 仓库设置（作者在网页上操作）：`main` 要求 PR、必需检查 `ci`、要求分支与 `main` 同步、禁止 force push 与删除。

**验收**

- [x] `gh api …/branches/main/protection/required_status_checks` 返回 `checks: [ci]`、`strict: true`
- [x] `docs/workflow.md` 与实际设置一致
- [x] `pnpm format:check` 绿

---

## T2312 canonical-dedupe

- 分支 / worktree：`fix/canonical-dedupe` → `../sass-canonical-dedupe`
- 依赖：—

**问题**

`e2e/changelog.spec.ts` 与 `e2e/blog.spec.ts` 的「标签页」用例间歇失败：`head link[rel="canonical"]` 命中两个元素，一个是本页的，另一个是**上一页**的（从 `/` 进来就是首页的，从 `/pricing` 进来就是定价页的）。`main` 上合入后的 CI 红过两次（69beba0、d358f4b），PR 上也反复要手动重跑。

**根因**（本地生产构建 + CPU 降速 6 倍复现）

两条用例都是 `page.goto` 之后马上点链接做客户端跳转，再断言 `<head>`。点击发生在上一页的流式 metadata 水合之前时，那一页服务端渲染出来的 `<link rel="canonical">` 没被 React 接管，跳转后也就没人删它：

- 立刻点击：60 次里 48 次失败，轮询 8 秒也不消失（不是慢，是永久残留）。
- 先等 `networkidle` + 3 秒再点：40 次全过。

爬虫每次都是直接请求 URL，拿到的 HTML 只有一条 canonical；残留只存在于「过早点击后客户端跳转」的 DOM 里，访客看不见。所以错的是测试的断言方式，不是站点的 SEO 输出。

**做**

- 两条用例保留客户端跳转对界面的断言；对 `<head>` 的断言改为先 `page.goto` 该 URL 重新加载（与爬虫取页面的方式一致），并加 `toHaveCount(1)`。
- 全部 e2e 里只有这两处在点击跳转后断言 `<head>`（按用例扫描过）。

**验收**

- [x] 同样的 CPU 降速 + 8 并发下，两条用例各跑 40 次，80 次全过
- [x] CI 的 `e2e (main)` 绿

---

## T2313 image-edit

- 分支 / worktree：`feat/image-edit` → `../sass-image-edit`
- 依赖：T2305（T2306 走买家路径时发现的真缺口，插在 T2306 之前）

**问题**

T2306 的参考产品是「上传商品图 → 生成宣传图」，需要以用户上传的图为输入生成新图。套件的 `runImage` 只收文字提示词，百炼图片适配器收到输入图时显式丢弃（`Image editing is not supported; input images were ignored.`）。买家想做图生图只能绕过 `runImage` 自己预扣、结算、退款 —— 那正是套件该兜住的部分。

出厂的 `qwen-image-3.0` 本身支持编辑（同一个 `multimodal-generation` 端点，`content` 里在文字前放 `{ "image": <url> }`，1–3 张，边长 384–2048 px、≤ 10 MB，核对于 2026-09）。

**做**

- `ai.imageModels[]` 加可选 `acceptsImage`（默认 `false`）：为 `true` 的模型可以带一张参考图。
- `runImage` / `POST /api/ai/image` 接收可选的 `imageFileId`：只认当前用户、状态为 `uploaded` 的图片文件（和图生视频的首帧同一套判据），给不接受参考图的模型传图返回 400。
- 百炼适配器把 `files` 里的 URL 转成 `{ image }` 放在文字前；不再对 `files` 报 unsupported（`mask` 仍然不支持）。
- `/playground` 的 Image 标签页：选中接受参考图的模型时，可以上传一张参考图。
- README 的 AI 一节、`.env.example` 不需要新变量；文档写明参考图的尺寸限制和失败时退款。

**不做**

- 多张参考图、蒙版（mask）编辑、OpenAI / Google 的图片编辑。
- 在服务端校验参考图的像素尺寸（服务商会拒绝，按模型失败退款）。

**验收**

- [x] 带参考图生成：`ai_usage`（`kind = image`、`succeeded`）、`files`、积分流水三处正确；服务商失败时退款
- [x] 别人的 `fileId`、未上传完成的文件、非图片文件、不接受参考图的模型：400，不扣分
- [x] 适配器单测覆盖请求体里的 `{ image }` 顺序与 mask 的 warning
- [x] `pnpm test` / `pnpm lint` / `pnpm typecheck` 绿；UI 改动跑 `e2e/ui-shell.spec.ts`

---

## T2314 doc-gaps

- 分支 / worktree：`docs/doc-gaps` → `../sass-doc-gaps`
- 依赖：T2605
- 建议在 T2306 之前做：T2306 是作者只凭发行包和包内文档走一遍买家路径，文档里漏的步骤会直接变成卡点。

**问题**

T2605 翻译随包文档时，逐段对照了代码，发现几处文档与代码不一致。翻译 PR 只改了明显过时的说法，下面这些涉及补充事实，没有顺手改：

`docs/billing.md`

- 「Switching providers」第 1 步只列了 Creem / Stripe / Lemon Squeezy 的产品对象，没有 Waffo（`site.config.ts` 的 `productIdEnvPrefix` 里是 `waffo: "WAFFO_PRODUCT_ID"`，ID 形如 `PROD_…`）。
- 第 2 步的环境变量块没有 Waffo：`WAFFO_MERCHANT_ID`、`WAFFO_PRIVATE_KEY`（必填）、`WAFFO_MODE`、`WAFFO_PRODUCT_ID_*`。
- 「How they actually differ in the product」表没有 Waffo 一列（Waffo 的差异写在它自己的小节里，属于缺口不是错误）。
- 「Which provider to use locally and in CI」里 fake 被禁用的条件不全：漏了 `WAFFO_MODE=prod`；写成「生产运行时一律失败」，实际 `ALLOW_FAKE_BILLING=1|true` 可以放行生产运行时（CI 就靠它），Vercel 与各家 live 模式的锁才放不开。以 `src/core/billing/env.ts` 的 `fakeBillingAllowed` 为准。
- Waffo 小节后的退款段落只总结了三家，没说 Waffo：按退款的那笔付款回收积分，部分 / 全额，14 天内。
- 代码注释同样没跟上：`billingServerEnv` 的文档注释没列 Waffo 变量，fake 相关的两处注释没提 `WAFFO_MODE=prod`（报错文案本身是对的）。

`docs/i18n.md`

- 「Adding a language」没提要在 `src/core/i18n/locales.ts` 的 `openGraphLocales` 里加一项（那里的注释要求每个新语言都加）。
- 同一节拿 `zh` 当例子，但 `zh` 已经在 `locales` 里了，换一个还没有的语言做例子。
- 「Testing」说 i18n 套件会「构建并启动」副本，实际本地跑的是 `next dev`，只有 CI 才构建再启动（`e2e/i18n/serve.ts`）。

`README.md`

- 开头介绍和「Quick start」列支付方式时只写 Creem / Stripe / Lemon Squeezy，没有 Waffo Pancake（上线清单里已经有它的小节）。

**做**

- 按代码补齐上面每一条；以代码为准，不改代码行为。注释的缺口（`billing/env.ts`）一起补。
- 改完跑 `pnpm english:check`（随包文件保持英文）和全仓锚点检查（改标题时同步链接）。

**验收**

- [ ] 上面每一条都有对应修改，或在 PR 里说明为什么不改
- [ ] 文档里出现的变量名、判断条件逐条能在代码里找到
- [ ] `pnpm format:check`、`pnpm english:check` 绿
