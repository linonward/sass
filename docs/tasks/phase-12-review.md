# 阶段 12：第三轮审查修复

阶段完成后：**自托管连非 UTC 的自建数据库也不会把时间算错**（会话时区被钉成 UTC）；退款/结算路径在乱序与并发下不丢积分、不多退、不双拿；买家从 zip 与 GitHub template 两条路径拿到的东西一致可交付；一批体验与防线问题（串行瀑布、可访问名、sitemap 收录、375px 覆盖、文档漂移）收口。

依据：2026-09-27 的第三轮全面审查（四个维度：安全与鉴权计费、数据层正确性、前端渲染与 i18n、模板交付与 DX；全部只读执行，high/medium 逐条读码复核）。结论是**无 blocker**：前两轮（阶段 8/9/10）的修复全部验证闭环，webhook 双层幂等、积分原子扣减、事务边界、zod 覆盖、admin 越权面、CSP、密钥与日志面均干净。本轮共 1 high + 12 medium + 约 24 low，落成四批 18 个任务。**落地过程中 T1201 的原 high 论断被实测推翻**，重新定性为「数据库会话时区」问题（medium 级），修正过程记录在 T1201 一节。

## 批次

- **批次 A（结算加固）**：T1201–T1204。退款/结算的资损路径，加一条环境正确性（T1201 会话时区）。
- **批次 B（交付闭环）**：T1205–T1209。买家可见的缺口与守卫。
- **批次 C（体验与防线）**：T1210–T1214。
- **批次 D（可后置）**：T1215–T1218。

批次内基本可并行。唯一的硬顺序是 **T1203 在 T1201 之后**（同改 `src/core/ai/video.ts`，先把时间基准钉死再修竞态）。T1204 自带一步 Creem test mode 实测，实测结论决定之后改多少。

## 明确不修 / 待定

- **checkout `requestId` 幂等语义**：不单独立卡，在 T1204 内用 test mode 实测定性。
- **`adjustCredits` 不调 `assertEnabled()`**：复核后不成立 —— `write()` 第一行已断言，它经 `write` 兜住。保留观察：若未来重构 `write` 去掉断言，它是唯一没有显式门禁的入口。
- **账户删除「取消订阅成功但删除事务失败」窗口**：代码已注释为接受项；`cancelSubscription` 对已取消幂等、操作可重试。不修。
- **pricing 营销页对匿名访客恒动态**（`await searchParams` + `getSession()`）：疑似设计权衡，拆 Suspense 或开 PPR 改造量不小，留待产品决策，不落卡。
- **`v1.0.0` tag 不存在**：开售时的手动动作（T503 验收项挂账），不进批次。
- 其余低价值/框架约束项（首页 `<title>` 仅站名、`og:locale` 输出 `en` 而非 `en_US`、根级 not-found 静态产物的 og:image 落 localhost）记录于此，不落卡。

---

## T1201 video-timezone

- 分支 / worktree：`fix/video-timezone` → `../sass-video-timezone`
- 依赖：—
- 依据：审查 H1 —— **落卡后实测推翻原论断，重新定性为「数据库会话时区」问题**（见下面的更正）

**审计更正（2026-09-27，真实数据库实测）**

原 H1 的论断是「非 UTC 的 **Node 进程**会把 `timestamp` 列读偏 → 视频超时误判」。实测不成立：

- drizzle 的列映射对无时区列**显式按 UTC 解析**（`drizzle-orm/pg-core/columns/timestamp.js:31`：`new Date(value + "+0000")`），写入用 `toISOString()`，比较参数按列的映射器编码（`sql/expressions/conditions.js` 的 `bindIfParam`）—— **ORM 路径与进程时区无关**。`TZ=Asia/Shanghai` 连真实库实测：默认值写读、JS Date 写读、`gte(列, date)` 比较全部正确。
- raw `db.execute` 返回的是字符串（drizzle 关掉了驱动的日期解析），但 `src/core` 里没有一处这样用日期。
- 真正的洞在**数据库会话时区**：`defaultNow()` 写的是**会话时区**墙钟，drizzle 读回按 UTC 解释。实测把会话时区设成 +8 后，`created_at` 读回来偏 **+480 分钟**。自建 Postgres 的服务器时区默认跟随操作系统，可能是本地时区。

**问题**

`src/core/db/client.ts` 建连接时没有约束会话时区；`src/core/db/schema/ai.ts:62` 的 `createdAt: timestamp("created_at").defaultNow()`（`video.ts:252` 的 elapsed 判定依赖它）在非 UTC 会话下会被读偏 8 小时。触发场景：自托管（T814 支持的场景）连一个服务器时区不是 UTC 的自建 Postgres —— 刚提交的视频任务首次 poll 就超过 30 分钟阈值、被误判超时并退款，或反向永不超时、积分卡住不退。Neon 与官方 postgres 镜像默认 UTC，不受影响。

**做**

- `createDbClient` 连接时把会话时区钉成 UTC（`options: "-c timezone=UTC"`；`pg` 与 `@neondatabase/serverless` 都支持该参数，后者本来就是 UTC，显式写出让行为一致）。
- 在 `client.ts` 注释里写明两条约束：timestamp 列按 UTC 墙钟存取；**不要在 raw `sql` 模板里插值 JS Date**（没有列上下文时 pg 按**进程**本地时区序列化成带偏移的字面量，timestamp 列会忽略偏移只取墙钟），用 drizzle 的列表达式。
- README 自托管一节写清楚 —— 买家不用再自己确认服务器时区。

**不做**：改进程时区（实测无必要）；`$defaultFn` 改写或全库 timestamptz 迁移（改动面大，收益已被会话时区修复覆盖）。

**验收**

- [x] DB 测试：客户端会话时区为 UTC；`defaultNow()` 写读一致；`gte(列, date)` 比较一致
- [x] DB 测试：`sessionTimezone: "Asia/Shanghai"` 时 `defaultNow()` 读偏 480 分钟 —— 既解释修复原因，也在实现被改动时报警（去掉 `options` 时两条测试都红）
- [ ] `pnpm test` + e2e 全绿

---

## T1202 refund-reclaim

- 分支 / worktree：`fix/refund-reclaim` → `../sass-refund-reclaim`
- 依赖：—
- 依据：审查数据层 M2、M7（已复核）

**问题**

退款事件先于付款事件到达时，**积分回收被永久跳过且无补偿**：

- `src/core/billing/reclaim-credits.ts:134-135`：`const granted = order?.planId ? (getPlan(order.planId)?.credits ?? 0) : 0; if (!order || granted <= 0) return;`
- :86：`if (!order.amount || order.amount <= 0) return null;`（跳过时仅记 `billing.refund_reclaim_skipped` 日志）。

**触发场景**：`subscription.paid` 处理时 DB 抖动返回 500（服务商稍后重试），期间 `refund.created` 先到 → `mergeOrder` 建出 amount/planId 为 null 的**占位订单** → 回收检查跳过 → 该 refund 事件已写入 `webhook_events` 被消费掉；随后 paid 重试补齐订单金额，但没有任何机制重触发回收 → **用户全额退款后积分永久留存**。套餐从 `site.config.ts` 下线后同理（`getPlan` 返回 undefined → granted=0）。webhook 乱序防护（lastEventAt）只保护订阅状态，保护不了这条路径。

**同根因连带（一并修）**：`src/core/admin/metrics.ts:112` 营收合计 `coalesce(sum(amount - refunded_amount), 0)`：占位订单 amount=null 时 `null - x = null`，**被 sum 忽略** → 净退款不进合计，后台营收虚高（:127 的过滤条件同理）。

**做**

- 回收跳过时落一条可重试的待处理记录（或把 reclaim 挂到后续付款事件的补齐路径上）。
- `granted` 的兜底改为从 `credit_transactions` 按 `(source, sourceId)` 查**实际发放额**，不依赖当前 `site.config`（套餐下线不再影响）。
- metrics 改 `coalesce(amount, 0) - coalesce(refunded_amount, 0)`（合计与过滤两处）。

**不做**：改 webhook 幂等模型（双层幂等是好的，缺的是补齐路径）。

**验收**

- [x] 单测：「refund 先到、paid 后到」的乱序场景 → 积分最终被回收
- [x] 单测：「套餐已从 config 下线」→ 仍按实际发放额回收
- [x] 单测：amount=null 的占位订单净退款计入营收合计（不再被 sum 忽略）
- [x] `pnpm test` + e2e 全绿

---

## T1203 video-settle-race

- 分支 / worktree：`fix/video-settle-race` → `../sass-video-settle-race`
- 依赖：T1201（同改 `src/core/ai/video.ts`，串行做）
- 依据：审查数据层 M3、M4（已复核）

**问题**

两处结算竞态，都会让用户「视频和退款双拿」或「积分永久不退」：

1. **转存与超时结算竞态**（`src/core/ai/video.ts:314-336`）：转存事务里 `update aiUsage set status='succeeded' where id and status='pending'` **不检查返回行数**（也没 returning 校验），事务照常提交、函数继续返回 succeededJob（含视频 URL）。并发 poll 中 A 路径已 `settleFailed` 退款置 failed 时，B 路径仍向客户端返回成功和视频地址 → **用户已拿到视频，积分也已退回**；同时 `aiUsage.fileId` 未关联、`files` 留下孤儿行。注释里「并发查询写的是同一个对象，files 按 key 去重」只解决对象重复，没解决状态竞态。
2. **settleUsage onlyIfPending 先置终态后退款**（`src/core/ai/usage.ts:203-206`）：

   ```ts
   if (onlyIfPending) {
     // 先抢到状态再退款，并发时只有一个请求会退。
     if ((await update()).length === 0) return false;
     await refund();
   }
   ```

   update 与 refund **不在同一事务**；refund 因 DB 抖动抛错时只留 `ai.settle_failed` 日志，后续 poll 见终态直接返回，无重试入口 → **积分永久不退**。「先抢状态防并发双退」可以保留，但要和退款同事务。

**做**

- 转存事务检查条件更新行数：0 行时按竞态处理（返回已定状态而不是成功），并考虑清理已写入的对象/记录。
- `update + refund` 合并进同一个 `db.transaction()`（`refundCredits` 已支持传 tx）；或 refund 失败时回滚状态让下次 poll 重试。

**验收**

- [ ] 单测：并发「成功转存」与「超时结算」不产生「视频 + 退款」双拿（用户拿到视频则积分不退；退款则拿不到视频）
- [ ] 单测：refund 抛错场景，积分最终退回（不因终态锁死而无重试）
- [ ] `pnpm test` + e2e 全绿

---

## T1204 checkout-idempotency

- 分支 / worktree：`fix/checkout-idempotency` → `../sass-checkout-idempotency`
- 依赖：—
- 依据：审查数据层 M5（代码侧已复核）、安全层（checkout 无限流，已复核）

**问题**

- `src/core/billing/checkout.ts:74-107`：订阅与一次性买断都是先 `SELECT ... limit 1` 查重、再调 `provider.createCheckout` —— **无锁、无唯一约束兜底**。
- `src/core/billing/providers/creem.ts:253`：`requestId: ${input.userId}:${input.planId}`，代码把「幂等」押在 provider 上；但 Creem 官方文档对 `request_id` 的描述只有 **"Identify and track each checkout request"**（2026-09-27 查证 docs.creem.io），**未承诺重复 requestId 返回既有 session**。
- `src/app/api/billing/checkout/route.ts`：POST 只做 `getSession` 校验，**无任何限流**；`checkout.ts:113` 每次调用都真实打到 `provider.createCheckout(...)`。

**触发场景**：双击升级按钮 → 两个并发 startCheckout 都查不到 active 订阅 → 创建两个结账会话 → 用户两个标签页都完成支付 → **双重扣款 + 双份订阅/积分**（若 requestId 非幂等）。反向风险：若 requestId 是长效幂等键，用户退订后再订阅同一套餐可能拿到旧 session。另有：任意登录免费用户脚本循环 POST `{planId:"pro"}` → 刷爆商户在 Creem 侧的 API 配额/触发风控，连带真实用户无法结账。

**实测结论（2026-09-27，Creem test mode）**

同一 `request_id` 连发两次 `POST /v1/checkouts`（`test-api.creem.io`）→ 返回**两个不同的 session**（`ch_4lVzH1lQD01EXLg3Kdx0YQ` / `ch_35TegH5nHwmLKOJPWQAj2C`），都能独立支付。即 **`request_id` 不是幂等键**（文档也没承诺）—— 双击确实能建出两个会话。附带发现：该接口对不带 `User-Agent` 的请求返回 403，实测脚本要带上。

**做（按实测结论落地）**

1. 限流：`site.config.ts` 加 `checkout` 策略（5/1m）；`startCheckout` 在参数校验后调 `checkRateLimit`，超限返回 `rate_limited`（limited → 429、Redis 不可用 → 503），路由写 `Retry-After`。
2. **去重与互斥**（关键）：单靠「锁用户行」挡不住 —— 刚建的结账会话在订阅/订单表里没有痕迹，第二个请求拿到锁后复查仍然查不到东西。落地成 **`checkout_sessions` 表 + 事务**：锁住用户行 → 复查重 → 未过期的会话直接复用同一个 URL → 都没有才建单并落库（`(user_id, plan_id)` 唯一，upsert）。复用窗口 30 分钟（`CHECKOUT_SESSION_TTL_MS`），过期后重建。
   取舍：provider 调用落在事务内（仓库里唯一一处），持连接约 0.5 秒；结账低频、正确性优先，代码注释里写明了这个取舍。

**不做**：只靠前端禁用重复提交（服务端必须自洽；前端 `disabled={pending}` 作为第一道防线保留）。

**验收**

- [x] 实测结论落 PR（同 request_id 两次调用返回两个不同 session）
- [x] 并发双击只建一个会话：`SlowProvider` 逼出真交错，**去掉行锁 → 用例红，恢复 → 绿**
- [x] 窗口内复用同一 URL、过期后重建（单测）
- [x] checkout 限流生效（第 N+1 次 429 + retryAfter；Redis 不可用 503）
- [ ] `pnpm test` + e2e 全绿（本地 899 passed；e2e 以 CI 为准）

---

## T1205 favicon

- 分支 / worktree：`fix/favicon` → `../sass-favicon`
- 依赖：—
- 依据：审查交付层 M6（已复核）

**问题**

全站没有 favicon：`public/` 只有 `logo.svg`；`src/core/seo/metadata.ts` 与 `src/app/[locale]/layout.tsx` 均无 `icons` 字段；无 `app/icon.*` / `favicon.ico` / `apple-icon`。买家按 README 品牌化后上线：浏览器标签页空白图标、`/favicon.ico` 在生产日志持续 404、Lighthouse/SEO 审计扣分。对一个「改一个配置换整站」的付费模板，这是买家最容易在上线后才发现的可见缺口。

**做**

- 加品牌化 favicon（Next 文件约定优先：`src/app/icon.svg`；如需跟随 `site.config.ts` 的品牌色，评估构建期生成或 `generateImageMetadata`）。
- README「改成自己的站点」步骤补一条：favicon 也要换。
- 可选：e2e 断言 `<link rel="icon">` 存在。

**不做**：PWA manifest / apple-touch 全套餐（除非顺手且零成本）。

**验收**

- [ ] `pnpm build` 产物里有 icon 路由；浏览器标签页显示品牌图标
- [ ] README 品牌化步骤覆盖 favicon
- [ ] `pnpm test` + e2e 全绿

---

## T1206 template-handoff

- 分支 / worktree：`fix/template-handoff` → `../sass-template-handoff`
- 依赖：—
- 依据：审查交付层 M7、M11（已复核）

**问题**

1. **GitHub template 路径泄漏卖家 agent 指令**：README:64 教买家第一步走 GitHub **「Use this template」**；但 `AGENTS.md`、`CLAUDE.md`、`docs/plan.md`、`docs/workflow.md`、`docs/tasks/` 只在 **zip 分发包**里被 `scripts/release-package.sh:27-31` 排除。GitHub 路径下这些文件原样进入买家的仓库 —— 目标买家明确包含 AI agent，买家的 Claude Code 会自动加载 AGENTS.md 的卖家硬规则（「不在 main 上提交」「一个任务 = 一个 worktree = `../sass-<topic>`」「PR 内同步更新任务表状态」），在买家的产品仓库里毫无意义甚至阻碍工作。zip 买家没有这个问题，两条交付路径体验不一致。
2. **落地页两处「模板自指」文案**（占位哨兵 T813 覆盖不到文案）：`messages/en.json` 的 `Landing.faq.license`（"Build and sell as many products as you like" 说的是**模板**授权，放在买家产品的 FAQ 里会让访客误读为自家产品可转售）；`Landing.hero.mock.terminalCommand`（`npx saas init --plan pro` —— 不存在的 CLI，纯装饰但很像真的）。

**做**

二选一并落实（注意 AGENTS.md 里的「This is NOT the Next.js you know」区块由 `next dev` 自动回写，不能整个删）：

- a) 把卖家工作流移出买家可见面：AGENTS.md 只留面向买家的构建约定，卖家规则（硬规则、workflow、任务表）移入只会进 zip 之外……反过来，即移入被 release-package.sh 排除的 docs/；或
- b) README 明示「拿到后删除清单」，并在 GitHub template 路径下同样有效。

两处文案改中性，或在 README 第 3 步点名提醒。

**验收**

- [ ] zip 与 GitHub 两条路径，买家都不会拿到无法解析的卖家指令（或 README 有明确、可执行的删除指引）
- [ ] 落地页 FAQ/LICENSE 文案不再对访客构成误导
- [ ] `pnpm test` + e2e 全绿

---

## T1207 notices-sync

- 分支 / worktree：`fix/notices-sync` → `../sass-notices-sync`
- 依赖：—
- 依据：审查交付层 M8、L8（已复核）

**问题**

- `THIRD-PARTY-NOTICES.md` 版本表已过期：:130-131 写 `@types/react 19.2.18` / `@types/react-dom 19.2.7`、:155 写 `react 19.2.8`、:191 写 `typescript 5.9.3`；而 dependabot #64/#65（commit 1beb827、18fe900，均晚于 TPN 最后修改 d208193）已升到 react 19.3.0 / @types ~19.3.0 / typescript 6.0.3（`pnpm-lock.yaml` 可证）。README「已验证的版本」一节也已改口 6.0.3。这是随付费产品分发的**法律合规文件**，声明的实际安装版本与买家 `pnpm install` 装到的不一致。
- 文件自己写了「改依赖时重跑 `pnpm licenses list`」，但**没有任何 CI/钩子提醒**，dependabot 每周 bump 会让它继续漂移。
- `scripts/release-package.sh` 有完整自检（凭据/卖家域名/内部文档零命中、必备文件），但 **CI 不跑它** —— 防线只在手动出包那一刻生效。

**做**

- 重跑 licenses 流程，同步 TPN 版本表（以锁文件为准）。
- 把 `scripts/release-package.sh` 的自检加进 CI（PR 或 main push 触发，成本约等于一次 unzip + grep）。
- 加 licenses 漂移检查（或至少在 CI 里比对 TPN 声明的核心版本与锁文件；实现方式自定，目标是「漂移会被 CI 拦住」）。

**验收**

- [ ] TPN 与 `pnpm-lock.yaml` 一致
- [ ] CI 新增步骤能拦住未来漂移（演示一次失败或说明机制覆盖范围）
- [ ] CI 全绿

---

## T1208 seed-gate

- 分支 / worktree：`fix/seed-gate` → `../sass-seed-gate`
- 依赖：—
- 依据：审查安全层（db-seed 闸门，已复核）

**问题**

`scripts/db-seed.mjs:146` 的生产闸门是 `if (process.env.NODE_ENV === "production")` —— **NODE_ENV 未设置时放行**。这与仓库其他闸门的哲学相反：`src/core/billing/env.ts` 的 `fakeBillingAllowed` 在 NODE_ENV 未设置时**按生产处理**；`src/core/create-env.ts:40-43` 的注释也明确「没设 NODE_ENV 的命令会被当成生产运行时」。脚本只预读 `.env.local`，而 `.env.local` 通常不写 NODE_ENV。

**触发场景**（运维误操作）：按 README/脚本注释的 `DATABASE_URL=postgres://… pnpm db:seed` 直连执行、shell 里 NODE_ENV 未设、DATABASE_URL 指向生产 Neon 库 → `email_verified=true` 的 demo 用户 + 假订阅/订单/积分流水写进生产库（demo 邮箱是 example.com 保留域，不可投递、不可接管），污染 admin 后台、指标与收入统计。

**做**

- 闸门对齐「未设 = 生产」：NODE_ENV 未设置或为 production 都拒绝；或要求显式 `ALLOW_DB_SEED=1` 才放行。
- 注释与提示信息给出清晰指引（「真要演示请用一个独立的库」）。

**验收**

- [x] `NODE_ENV` 未设置时脚本拒绝执行并给出清晰指引（手动验证 + 若方便则加脚本级测试）
- [x] 显式放行路径（如 `ALLOW_DB_SEED=1`）可用
- [ ] CI 全绿

---

## T1209 not-found-canonical

- 分支 / worktree：`fix/not-found-canonical` → `../sass-not-found-canonical`
- 依赖：—
- 依据：审查 SEO 补 B（已复核；代码注释自认挂账）

**问题**

`src/app/[locale]/layout.tsx:36` 的 `buildMetadata({ locale, path: "/" })` 使 layout 级 canonical 指向首页；`src/app/[locale]/not-found.tsx:31` 的 `generateMetadata` 只返回 `{ title }`，第 16 行注释明写「这里不调 buildMetadata（canonical 会指向首页，留待后续任务处理）」。Next 元数据浅合并 → **404 静态 HTML 带指向首页的 canonical（和 hreflang）**。框架对 not-found 自动注入 `noindex`，实际不会被收录，但这是矛盾信号，且是仓库自己挂账的未完成项。

**做**

- 给 `buildMetadata` 增加「不带 canonical」的可选分支（或显式路径参数），404 输出自己的元数据：不输出 canonical / hreflang（或指向自身，若框架允许）。
- 顺带核对 404 的 og 字段是否有同样的继承问题。

**验收**

- [ ] 关闭 JS 抓取 404 静态 HTML，`<link rel="canonical">` 不再指向首页
- [ ] 既有 seo e2e 扩展锁住该行为（与 T904 的 404 元数据用例协调）
- [ ] `pnpm test` + e2e 全绿

---

## T1210 serial-queries-2

- 分支 / worktree：`fix/serial-queries-2` → `../sass-serial-queries-2`
- 依赖：—
- 依据：审查前端 M9（已复核）

**问题**

阶段 10「serial-queries」同款模式的漏修，独立操作被串行 await：

- `src/app/[locale]/(admin)/admin/users/[id]/page.tsx:39-45`：`await getUserDetail(...)`（内部 4 路并行 SQL）之后才 `await getTranslations ×3 + getFormatter`，五者互相独立却全串行。
- `src/app/[locale]/(admin)/admin/orders/page.tsx:47-50`、`admin/subscriptions/page.tsx:58-62`、`admin/users/page.tsx:41-43`：DB 列表查询排在 3~4 个翻译 await **之后**。
- `src/app/[locale]/(app)/billing/page.tsx:38-41`：`requirePageSession`（打 DB）排在 3 个翻译 await 之后，把其后已正确 `Promise.all` 的三查询整体推迟一跳。

影响：每次请求多 1~4 跳串行往返（翻译走每请求缓存，但和 DB 往返完全不重叠）。正确样例就在同仓：`admin/metrics/page.tsx:58-67` 的 `Promise.all` 写法。

**做**

- 按 `admin/metrics/page.tsx` 的模式重排上述四处。

**不做**：动数据获取的缓存策略（另查过，无问题）。

**验收**

- [ ] 四处改完行为不变（e2e 全绿）
- [ ] PR 里说明每页各少了几跳（对照 metrics 页写法）

---

## T1211 ui-a11y-i18n

- 分支 / worktree：`fix/ui-a11y-i18n` → `../sass-ui-a11y-i18n`
- 依赖：—
- 依据：审查前端 M10、L7（已复核）

**问题**

shadcn 系 UI 原语的可访问名硬编码英文，绕过 i18n：

- `src/core/ui/sidebar.tsx:195-196`：`<SheetTitle>Sidebar</SheetTitle>`、`<SheetDescription>Displays the mobile sidebar.</SheetDescription>` —— 后台移动端侧栏读屏必念；`en.json:287` 已有 `Dashboard.sidebar` 键却没接上，description 连键都没有。
- `src/core/ui/sheet.tsx:77`、`src/core/ui/dialog.tsx:78`：`<span className="sr-only">Close</span>` —— mobile-nav 与 settings 弹窗的关闭按钮可访问名永远是英文，en.json 无 "Close" 键。
- `src/core/ui/sidebar.tsx:271/283/286`：`"Toggle Sidebar"` ×3（硬编码值大写 S，与 en.json `Dashboard.toggleSidebar` = "Toggle sidebar" 不一致；调用方传的 aria-label 能盖住 283/286，271 的 sr-only span 盖不住）。

买家新增语言后这几处不翻译且无法从调用方覆盖；`client-messages.test.ts` 的守卫只扫 `useTranslations`，扫不到这类硬编码。

**做**

- 给三个原语的可访问名接上 i18n（调用级传入 labels 或经 provider 取 `useTranslations`，实现自定；要求默认有本地化值、en.json 补齐键）。
- 连带（先确认再改）：`src/core/legal/legal-page.tsx:18`（`Intl.DateTimeFormat("en-US")`）与 :44（`Effective date:` JSX 文本）—— 若确认页头是装饰性标签而非法律正文的一部分，一并接 i18n（blog 的 `PostDate` 已是跟随 locale 的样例）；若属正文取舍，在 PR 里记录。
- 评估把「硬编码可访问名」加入 `client-messages.test.ts` 的守卫范围（可选）。

**验收**

- [x] 上述三处原语的可访问名可本地化，en.json 有对应键（原语收 `labels` / `closeLabel`，调用方传 `t(...)`；新增 `Dashboard.sidebarDescription`、`Common.close`）
- [x] 读屏流程（侧栏、弹窗关闭）在非英文 locale 下读到本地化文本（单测用伪翻译渲染侧栏抽屉/触发器/导轨；`a11y-labels.test.tsx` 锁原语的覆盖与兜底）
- [x] `pnpm test` + e2e 全绿（本地 88 文件 927 passed；`ui-shell` + `dashboard` 两个 spec 共 36 passed，以 CI 为准）

---

## T1212 blog-sitemap

- 分支 / worktree：`fix/blog-sitemap` → `../sass-blog-sitemap`
- 依赖：—
- 依据：审查 SEO 补 A（已复核）

**问题**

- `src/core/blog/sitemap.ts:14-38`：`blogSitemap()` 只生成 index + 每篇文章条目（`return [...index, ...posts]`）。但 `blog/page/[page]`、`blog/tags/[tag]`、`blog/tags/[tag]/page/[page]` 三组路由**可索引**（无 noindex、canonical 自指，构建产物已预渲染），却都不在 sitemap —— 只能靠 `post-list.tsx` 的内链被发现，收录延迟随博客增长放大。
- 连带：`src/app/robots.ts:14-19` 的 `Disallow /dashboard、/admin` 与页面自身 `noIndex:true` 构成**双重封锁互相抵消** —— 被 Disallow 的页面爬虫读不到 meta noindex，有外链时可能以裸 URL 出现在结果里。二选一。
- 连带：`src/core/blog/posts.ts:19` `tagPath` 未做 URL 编码（当前 tag 全是安全 ASCII 不触发；未来非 ASCII tag 会使 canonical/sitemap/og 与实际路由编码不一致）。

**做**

- sitemap 补上 tag 页与分页页；**或**对低价值 tag 页显式 noindex，保持「可索引 ⇔ 在 sitemap」自洽（二选一，PR 里说明取舍）。
- robots 的 Disallow 与 meta noindex 二选一。
- `tagPath` 补 `encodeURIComponent`（并与 canonical/og 的生成对齐）。

**验收**

- [ ] 构建产物 sitemap.xml 与站点「可索引页面集合」一致
- [ ] robots 不再与 meta noindex 互相抵消
- [ ] 非 ASCII tag 的路径编码一致（单测）
- [ ] 既有 seo e2e 扩展全绿

---

## T1213 overflow-e2e

- 分支 / worktree：`chore/overflow-e2e` → `../sass-overflow-e2e`
- 依赖：—
- 依据：审查前端 L4（已复核）

**问题**

AGENTS.md 把「375px 不横向溢出」列为 e2e 锁死的规则，现有防线只覆盖 `/`、blog、legal、dashboard、admin。**T607 后的 404 页**（`src/app/[locale]/not-found.tsx:41-68` 首次自渲染 `SiteHeader`（sticky + 硬唇边 shadow）/`SiteFooter`/44px 营销按钮）与 **sign-in 页**没有覆盖 —— 未来样式回归 CI 接不住。

**做**

- 给 not-found 与 sign-in 补 375px 不横向溢出断言，并入现有 spec 风格（参考 `ui-shell.spec.ts:50-62`）。

**验收**

- [ ] 两条新用例本地与 CI 全绿
- [ ] 故意加一个超宽元素时用例能失败（PR 里说明验证过）

---

## T1214 readme-drift

- 分支 / worktree：`docs/readme-drift` → `../sass-readme-drift`
- 依赖：—
- 依据：审查交付层 L4、L5、L6、L10（已复核）

**问题**

- README:322-323 声称 `grep -rn "Suspense" src/ | wc -l # 0`，实际为 1（`src/core/ai/playground-tabs.tsx:40` 的注释），且该组件用 `next/dynamic` + `loading`，playground 页面内部确有 Suspense 边界（不涉及 notFound 路径）。这一节是买家/agent 判断 404 行为的权威依据，命令输出对不上会削弱整节可信度。
- 内部流程术语泄漏到买家文档：README:398-401 上线清单里的「（阶段 2）（阶段 3）」、README:408 残留「具体变量名由对应模块的任务补充到本节。」、UPGRADING.md:86-90 的「（T606 起）（T605 起）」、`docs/design.md:3` 状态行引用 T605/T606/T607。
- 发行代码注释悬空引用被排除的内部文档：`site.config.ts:147`（docs/plan.md）、`src/core/config/schema.ts:337,385`（docs/plan.md）、`src/app/not-found.tsx:22`（docs/tasks/phase-9-boundaries.md）—— zip 买家顺着注释找文件会扑空。
- `docs/plan.md:3` 状态行陈旧（「已确认，待实施」vs 阶段 1–11 全部 done）。

**做**

- 逐条清理/改写：悬空引用改为指向 README 对应章节或把内容内联；内部术语替换为自洽表述；README 的 grep 命令与实际对齐（或改为不依赖具体计数的表述）；plan.md 状态行更新。
- 顺带把 README:322 的表述限定范围（playground 内部有流式边界，但不涉及 notFound 路径）。

**验收**

- [ ] README 里的验证命令逐条实测输出一致
- [ ] zip 分发包内的代码注释不再引用被排除的文件
- [ ] CI 全绿

---

## T1215 email-outbox

- 分支 / worktree：`fix/email-outbox` → `../sass-email-outbox`
- 依赖：—
- 依据：审查数据层 M6（已复核）

**问题**

事务性邮件是 **at-most-once**：`src/core/email/notification-log.ts` 的 `(kind, key)` claim 在计费事务内 upsert 占名额，`afterCommit`（经 `runAfterResponse`）发送失败仅记日志。**触发场景**：payment-succeeded 的 webhook 事务提交（claim 已占）→ `after()` 阶段进程被回收或 Resend 宕机 → 邮件丢失；服务商重试 webhook 被 `webhook_events` duplicate 挡下，claim 也拦截重发 → **付款成功邮件永久不发**。注释表明 at-most-once 是有意选择（防重复轰炸），但与「付款成功通知」这类关键邮件的重要性不匹配。

**做**

- 发送失败时删除 claim 行（允许下次重试重新占名额）；或引入 outbox 扫描补发。至少让失败可自动/人工重试。

**验收**

- [ ] 单测：模拟发送失败 → 之后能重试成功
- [ ] 正常路径不重复发送（现有单测保持绿）
- [ ] `pnpm test` + e2e 全绿

---

## T1216 ratelimit-selfhost

- 分支 / worktree：`fix/ratelimit-selfhost` → `../sass-ratelimit-selfhost`
- 依赖：—
- 依据：审查安全层（fail-open，已复核）

**问题**

`src/core/ratelimit/limiter.ts:77-85`：未配置 Upstash 时直接 `{ ok: true, retryAfter: 0 }` 放行，只 warn 一次（`site.config.ts:170` `failMode: "open"`）。Vercel 生产由 `src/core/ratelimit/env.ts` 强制要求 key，风险**仅限自托管**：漏配 `UPSTASH_*` → AI/上传限流整体关闭，且只有启动时一行 warn 日志（极易淹没）。

**做**

- 生产运行时 fail-closed（无 Upstash 即启动失败或拒绝请求）；或至少：启动时醒目告警 + 健康检查项 + 自托管文档显著强调。
- 与 T814 的自托管反代文档一节合并说明。

**验收**

- [ ] 自托管未配 Upstash 时有明确、可发现的信号（启动失败/告警/健康检查其一）
- [ ] 文档更新
- [ ] CI 全绿

---

## T1217 frontend-details

- 分支 / worktree：`chore/frontend-details` → `../sass-frontend-details`
- 依赖：—
- 依据：审查前端 L5、L6、L8、L9（已复核）

**问题**

一批相互独立的小问题：

- `src/features/example/tagline-tool.tsx:74`：`<li key={line}>` 用生成内容本身当 key —— AI 生成重复 tagline 时 key 冲突（React 警告 + 潜在错渲染）。**示例代码会被买家照抄**，应改 `${i}-${line}`。
- 同文件 :44：`defaultValue={state.status === "done" ? state.product : undefined}` —— React 不会在 mount 后重新应用 defaultValue，该三元是死代码（当前无可见 bug）。删掉或改成真正起作用的形式。
- `src/core/ai/generations-context.tsx:82-93`：轮询的 `stopped` 标志只在安排下一轮前检查，`await fetch` 返回后直接 `settle(...)`（setState）；unmount 后是 no-op 无实害，但与 `checkout-status.tsx` 的 AbortController 标准写法不一致，切页也不真正取消 in-flight 请求。
- `/api/ai/video/[id]` 轮询：`src/core/ai/handlers.ts` 的响应无 `cache-control: no-store`，客户端 `generations-context.tsx:87` 的 fetch 也没带 —— 对照 `billing/status` 是两侧都设。
- `src/core/email/brand.ts:13-19` 用冷灰 hex（#171717/#737373/#e5e5e5/#f5f5f5），`src/core/seo/og-card.tsx:26-27` 用 #0a0a0a/#fafafa，与站内「暖墨」token（brand-css 的 `foregroundFor` 产出 #191614/#fcf9f7）色相不一致。邮件客户端不支持 CSS 变量、hex 本身必要，但同一「主色上放什么字」的决策应复用同一组值（疑似刻意，先确认再统一或加注释）。

**做**

- 逐项修复/确认并记录取舍。

**验收**

- [ ] 示例无 React key 警告；死代码删除
- [ ] 轮询有 abort + no-store，与 checkout-status 写法一致
- [ ] 邮件/OG 的中性色要么与 token 对齐、要么有注释说明为什么不同
- [ ] `pnpm test` + e2e 全绿

---

## T1218 docker-notes

- 分支 / worktree：`docs/docker-notes` → `../sass-docker-notes`
- 依赖：—
- 依据：审查交付层 L7（已复核）

**问题**

README:533-537「自托管（自己的服务器 / Docker）」说「或打包成 Docker」，且 :213/:263/:454 多处把 Docker 与生产闸门并列；但仓库**没有 Dockerfile**，`next.config.ts` 也没设 `output: "standalone"`（Docker 化 Next 的常规前提）。想走 Docker 的买家发现所有生产守卫都考虑到了 Docker（NODE_ENV 判定），却没有可复制的镜像构建路径。

**做**

二选一：补一个参考 Dockerfile（含 `output: "standalone"`、`db:migrate` 的执行时机、环境变量注入说明），或把措辞降为「自行容器化」并写清前置条件（standalone 输出、migrate 时机）。

**验收**

- [ ] 文档与仓库实际一致（要么有可复现的 Dockerfile 与说明，要么不再承诺 Docker 路径）
- [ ] CI 全绿
