# 阶段 16：合入后审查收口

T1302（渠道报表）与 T1305（邀请链接）**合入 `main` 之后**才回来的两份代码审查，发现的都是**已经在 `main` 上跑着**的行为。阶段 16 把它们按严重度收口。

依据：`/code-review` 对 #107 的十角度审查（含临时库 EXPLAIN 实测与 React 19.3 + jsdom 实测）与一份独立审查对 #108 的核对。两轮都只报告不修，所以下面每条的现状都指 `main` 的 `43ad0bc`。

复核口径：写进「问题」的事实我逐条核过源码；只有 EXPLAIN 那条是审查方在临时库上实测的（我没有重跑），卡里标了「需实测复核」。

## 批次

- **批次 A（T1601–T1603）报表**：#107 的发现，按正确性 → 性能 → UI/文档拆开，三条可并行，但 T1601 会动 `report.ts` 的收入查询，T1602 也动它，同文件建议 T1601 先。
- **批次 B（T1604）邀请**：#108 的发现，独立可并行。
- **T1605 独立小项**：T1401 的验收口径在合入过程中被打破，单独一条，可随时做、建议先做。
- **不新开卡**：T1306 的删号外键方向直接补进它自己的卡（见文末）。

## 明确不修 / 待定

- **归因与邀请的隔离本身没问题**：两个 Cookie、purpose 写在签名载荷里、`context.test.ts` 断言互相读都是 null，而且根本没有 `?ref=` 参与归因，「`ref` 覆盖营销来源」在构造上不可能发生。审查看过，不动。
- **已登录但无关系的账号直接 POST 接受接口仍会写上下文 Cookie**（页面不给按钮）：无害 —— 绑定只发生在 `user.create.after`，且身份早已存在。服务端比页面声明宽松，记录不改。
- **`attribution:false + referrals:true` 这个组合没有集成测试**（acquisition e2e 三个开关全开，单测覆盖的是 Cookie 层独立性）：结论由单测 + 结构推出，不是集成跑出来的。记录在此，不单独立卡；T1604 若顺手能加就加。
- **`ensureCode` 的无目标 `onConflictDoNothing()`、邀请码的 60 bit 空间与统一错误文案、`/referrals` 与 `/invite/[code]` 的 `noIndex`**：审查确认是有意为之且成立，不动。

---

## T1601 report-money

- 分支 / worktree：`fix/report-money` → `../sass-report-money`
- 依赖：—

**问题**（都在 `src/core/acquisition/report.ts` 与 `src/core/admin/metrics.ts`）

1. **两页的收入口径对不上，而注释说它们一致。** `collectedStatuses` 确实是共用常量，但派生定义不同：
   - metrics：`collected = 区间内 且 status ∈ collectedStatuses`，`orderNet = coalesce(amount,0) - coalesce(refundedAmount,0)`，付费用户还要求 `orderNet > 0`（`src/core/admin/metrics.ts:117-132`）。
   - 报表：`paid` 额外要求 `isNotNull(orders.amount)`（`report.ts:158-163`），付费人数只是 `countDistinct(orders.userId)`。

   后果：一笔「退款先到、付款事件还没补齐」的订单（`amount IS NULL`、`refundedAmount > 0`）在 metrics 记成负收入、在报表进「待核对」且不算收入；全额退款过的用户在 metrics 不算付费、在报表算。同一区间两页数字都对不上，运营无法判断哪个对。而 `metrics.ts:93` 的注释写的是「渠道报表用同一份定义，两页的收入口径才不会走偏」—— 这句话目前是不成立的。

2. **真实取值与合成桶合并。** `sourceOf = coalesce(snapshot->>'source','unknown')`：没有归因行、已撤回、以及**真的**把 `utm_source` 填成 `unknown` 或 `direct` 的流量，全落进同一行。`campaignField` / `sourceField` 的白名单接受这两个字面量，捕获侧原样写库。

3. **`getFilterOptions` 列不出来的行。** 来源下拉只从 `user_attribution` 取（`report.ts:206-212`），而表格里注册数最多的一行往往是「未知」—— 它主要来自没有归因行的用户，永远不在下拉里，只能手写 `?source=unknown`。现有库测试用一条「撤回墓碑」把缺口盖住了（`report-db.test.ts` 的 `ids.withdrawn`）。

4. **`paid` 且金额未知且未退款的订单在报表里整笔消失**：四个分支都不落它（`/admin/orders` 却显示 Paid）。该行可达 —— `mergeOrder` 用 `patch.outcome ?? "paid"` 建行，`creem.ts` 的 `asNumber(order?.amount)` 缺金额时是 null。

5. **`coalesce(sum(...), 0)::int` 溢出**：累计净收入或待核对退款超过 2147483647 分时报 22003，整页 500（metrics 里是既有同款写法，报表抄了一遍）。

**做**

- 定一份**两页共用**的收入口径（金额未知的订单算不算、退款先到怎么记、付费人数的定义），写成一处注释 + 一处可引用的文档，两个模块都按它实现；`metrics.ts:93` 的注释要么变成真的、要么说清差异。
- 把「没有归因行」的合成桶与 `utm_source` 的字面量取值区分开（合成桶用一个不可能是 utm 取值的标记，或在报表里显式标注两者不同）。
- `getFilterOptions` 补上表格里实际会出现的桶，并让 `report-db.test.ts` 覆盖「没有撤回墓碑、也没有归因行」的情形。
- 给「paid 但金额未知」定归属并写进列定义。
- 聚合改 `::bigint` 或读出后再取整。

**不做**：改 `/admin/orders` 对 Paid 的判定（那是另一张卡）；为了让两页一致而删掉「待核对」这一列 —— 它是这一版特意加的，价值在于把不可信金额单独摆出来。

**验收**

- [ ] 同一区间、同一来源，两页的「净收入」「付费人数」要么相等、要么差异有明写在文档里的解释
- [ ] 一行「没有归因行」与一行 `utm_source=unknown` 在报表里不是同一行（或明确标为同一行且有说明）
- [ ] 来源下拉里有表格上出现的每一个来源
- [ ] `paid` + 金额未知 + 未退款 的订单在报表里能找到它落在哪一列
- [ ] 金额超过 int32 时报表显示数字而不是 500

**测试**：库集成测试覆盖上面五条各自的边界（尤其 `amount IS NULL` 的三种组合）；`/admin/metrics` 与 `/admin/acquisition` 的口径对照写进测试，别只写注释。

---

## T1602 report-perf

- 分支 / worktree：`fix/report-perf` → `../sass-report-perf`
- 依赖：T1601（同改 `report.ts` 的查询）

**问题**

1. **新加的表达式索引服务不了报表自己的查询。** `user_attribution_source_idx`（`src/core/db/schema/acquisition.ts:26`）与报表的查询形状不匹配：筛选谓词挂在 `LEFT JOIN` 的可空侧，计划里只能当 join 之后的 Filter。审查方在临时库（6 万行、`VACUUM ANALYZE`、真索引）实测：默认计划不引用该索引；`set local enable_seqscan=off` 仍不用；改成 inner join 的对照才出现 `Bitmap Index Scan … Index Cond`。**这条与 #107 描述里「EXPLAIN (enable_seqscan=off) 确认命中该索引」相反 —— 实现时以自己实测为准。** 现状是每次注册都多付一次索引写入，而筛选仍要全表扫 + join 后过滤。
2. **默认视图跑三条用不到的全表聚合。** `getFilterOptions` 每次渲染都对整张 `user_attribution` 跑一条全量 `group by` 加两条 `selectDistinct`，并与报表四组聚合并发（同池共 7 条查询）。无筛选的默认视图并不需要这些取值。

**做**

- 先实测确认索引到底有没有被用（`EXPLAIN (ANALYZE, BUFFERS)` + 真数据）；然后二选一：改查询形状让它可用（inner join / 把筛选下推）或改索引定义，**或者删掉**——留一个只在写入侧付费的索引比没有更糟，注释也得跟着改。
- `getFilterOptions` 改成按需或加缓存，别让默认视图为它付出全表代价。
- 顺带看 `user_attribution` 上是否还需要别的索引支撑报表的四组聚合。

**验收**

- [ ] 用到索引的那条路径有 `EXPLAIN` 输出贴在 PR 里（含数据量、是否 ANALYZE）
- [ ] `report.ts` 里关于索引的注释与实测一致
- [ ] 无筛选打开 `/admin/acquisition` 不再对 `user_attribution` 做无界聚合（或说明为什么保留）
- [ ] 索引增删与 `docs/design` / README 里对后台性能的任何描述一致

**测试**：库集成测试锁「筛选后的结果集」不变（性能本身不进单元测试）；`EXPLAIN` 结论写进 PR 描述。

---

## T1603 report-ui

- 分支 / worktree：`fix/report-ui` → `../sass-report-ui`
- 依赖：—

**问题**

1. **报表页自己写的 `money()` 没有兜底**（`src/app/[locale]/(admin)/admin/acquisition/page.tsx:62`）：没有 metrics 的 `?? billing.currency`、没有 `toUpperCase()`。`orders.currency` 是自由文本列，于是 NULL 币种显示成裸数字、`usd` 与 `USD` 在同一格拆成两条、非法币种（如 `USDC`）让 `Intl.NumberFormat` 抛 RangeError —— **整个报表页 500，且这笔坏数据不清掉就一直 500**。
2. **三个 `<select>` 只给 `defaultValue`**（`report-filters.tsx:83`）：同一路由换 searchParams 的客户端跳转不会重新挂载节点，React 不再应用新的 `defaultValue`（审查方用 React 19.3 + jsdom 实测：同树更新后 `select.value` 保持旧值，remount 才会更新），下拉显示的筛选与表格实际应用的筛选不一致。同页的 RangeFilter 与列表页的 StatusFilter 都从 URL 派生当前态，这里是唯一会说谎的控件。
3. **缺 `sections.revenue` 开关**：metrics 页在没有付费套餐时不显示收入区块（`metrics/page.tsx:39`，README:255 把它写成了规则），报表页无条件渲染 Net revenue / Refunds to reconcile 两列，免费部署上永远是「—」。
4. **买家文档在说反话**：README:604 仍写「模板不含渠道报表页……需要报表时自行查询」，README:250 仍写「后台有指标页和用户、订单、订阅三个列表」，README:255 只描述 metrics 的收入口径（且与报表不一致，见 T1601）。
5. **本地跑不通、CI 却绿**：`docs/workflow.md:46` 的 `ADMIN_EMAILS` 只有原来两个邮箱，ci.yml 已经四个（加了 acquisition 套件的两个）。照文档在本地跑 `pnpm test:e2e:acquisition`，管理员拿不到角色 → `/admin/acquisition` 404 → 全红，而 CI 全绿，会被误判成环境坏了。
6. **e2e 从不提交筛选表单**：断言全是手拼查询串的 `goto`，Apply 按钮的 GET 提交、隐藏的 range 输入、三个 select 的 name 都没锁；空选项 `value=""` 还会让每次提交都写进 `source=&medium=&campaign=` 三个死参数（服务端当没传，但与同页维护的规范 URL 不一致）。
7. **`selectClass` 丢了同套原语的状态**（`report-filters.tsx:16`）：只抄了边与聚焦环，没有 `dark:bg-input/30`、`disabled:*`、`aria-invalid:*`、`text-base md:text-sm`。仓库另外四处原生 select 都保留着这些；少 `text-base` 会让 iOS Safari 聚焦时缩放页面。

**做**

- 货币格式化统一到一处（复用 metrics 的兜底与 upper 逻辑），非法/NULL 币种不能让整页挂。
- 筛选控件变成受控或加 `key`，让它跟随 URL；空选项不要写进查询串。
- 补 `sections.revenue` 开关，两个后台页一致。
- README 的 250 / 255 / 604 三处按实际上线的功能重写。
- `docs/workflow.md` 的本地 e2e 命令补上 acquisition 的两个管理员邮箱。
- 补一条「填筛选 → 点 Apply → URL 与表格都对」的 e2e。
- `selectClass` 与 Input 对齐（含深色与禁用态）。

**验收**

- [ ] 币种为 NULL / 小写 / 非法时，报表页分别显示兜底、不拆行、不 500
- [ ] 从带筛选参数的 URL 客户端跳转回 `/admin/acquisition`，下拉显示与实际筛选一致
- [ ] 无付费套餐的部署不显示收入两列
- [ ] README 里找不到「模板不含渠道报表页」这类与现状相反的描述
- [ ] 照 `docs/workflow.md` 在本地跑 acquisition e2e 全绿
- [ ] 新 e2e 覆盖 Apply 提交路径

**测试**：UI 改动至少跑 `npx playwright test e2e/ui-shell.spec.ts e2e/landing.spec.ts` + acquisition 套件；375px 无横向溢出、可访问名与键盘操作正确。

---

## T1604 referral-fixes

- 分支 / worktree：`fix/referral-fixes` → `../sass-referral-fixes`
- 依赖：—

**问题**

1. **「other」视图的 Accept 按钮是静默空操作。** 访客已经接受过 A 的邀请（30 天窗口内）再打开 B 的链接时，页面文案说「第一个邀请仍然有效，想换成这个请先清除」，但**同时**渲染着 `[Accept invitation]`（`invite-actions.tsx:52` 只在 `mode === "accepted"` 时隐藏，`other` 走的是 `mode="clear"`）。点它 → 服务端在已有上下文时直接返回 `{accepted:true, code:<A>}` 200（`http.ts:59-61`）→ 客户端 `router.refresh()` → **页面不变、没有报错、没有任何反馈**，用户以为自己接受了 B。e2e 覆盖了 offer/accepted/bound/self/signedIn/invalid，**唯独没有 other**。
2. **邀请数被静默截断。** 页面 `t("invitedCount", { count: invited.length })` 而 service 的 `limit = 50`：邀请满 50 人后显示一个偏小的数字，列表也没有「只显示前 50 条」的说明。T1306 要在这页显示奖励时，截断会直接变成口径问题。
3. **公开的接受接口没有频率限制。** 未登录任何人都能 POST，每次跑一次按主键的 `resolveInviter`（已登录时多一次 `relationshipFor`）。无写入、无邮件，收益低，但留资那两条公开入口都有 limiter，关闭限流要靠 `ALLOW_UNRATELIMITED` 显式放行 —— 口径不一致。
4. **关闭模块时未登录访客是被重定向而不是 404**：`referrals.enabled=false` 且未登录 → 302 到 `/sign-in?callbackURL=/referrals`（登录后才 404）。`e2e/acquisition-disabled.spec.ts` 只测了已登录那一半。playground 是同一形状（有先例），而 leads 的 `/waitlist` 直接 404。

**做**

- `mode="clear"` 不渲染 Accept 按钮（或明确回显「仍是第一个邀请」），并补一条 other 视图的 e2e。
- 邀请数改成真实总数（或用总数 + 「显示前 50 条」的文案），别让数字说谎。
- 给接受接口加与 `leads` 同口径的 limiter，或明确记录为什么不加。
- 未登录访问已关闭的 `/referrals` 与已登录一致（404 或先 404 再重定向），并补 e2e。

**不做**：改邀请码格式、签名信封、绑定时机（`user.create.after`）与唯一性约束 —— 审查看过，成立。

**验收**

- [ ] 已有上下文时打开第二个邀请链接，页面上不存在会静默失败的按钮；点任何留下的按钮都有可见结果
- [ ] 邀请满 50 人时页面数字与列表都可解释
- [ ] 接受接口有 limiter（或 PR 里写明不加的理由与代价）
- [ ] 关闭模块时未登录访客与已登录访客的响应一致

**测试**：补 other 视图与关闭模块未登录两条 e2e；limiter 走现有 rate-limit 测试形状。

---

## T1605 internal-terms-2

- 分支 / worktree：`chore/internal-terms-2` → `../sass-internal-terms-2`
- 依赖：—

**问题**

T1401 的验收口径（`src/`、`e2e/`、`site.config.ts`、`README.md`、`UPGRADING.md` 里 `T[0-9]{3}` 零命中）在 T1302 / T1305 合入后**又被打破**，`main` 上现在有 3 处：

- `src/core/acquisition/report.ts:150` —— 「净收入变成负数（T1202）」
- `src/core/acquisition/referrals/service.ts:6` —— 「奖励结算（T1306）在此基础上推进」
- `src/core/db/schema/referrals.ts:26` —— 「奖励结算（T1306）只推进状态」

T1401 的检查是人工 `grep`，没有闸，所以合入时没人拦。买家在 `src/` 里搜到这些编号，却找不到对应任务卡（`docs/tasks` 不随包交付）。

**做**

- 三处改写成自洽表述（能指向买家可见文档的就指过去，否则内联一句）。
- **把这条检查变成闸**：加进 `scripts/release-package.sh`（它已经在做「凭据 / 卖家域名 / 内部文档」三件零命中检查，这是第四件），这样每个 PR 都跑。注意模式要写成 `T[0-9]\{3\}` 之类，别让脚本自己的源码命中自己（脚本里已有同类注释说明这个坑）。
- 顺带确认 `docs/` 里的内部文档不算 —— 它们本来就不进包。

**验收**

- [ ] `grep -rn "T[0-9]\{3\}" src/ e2e/ site.config.ts README.md UPGRADING.md` 零命中
- [ ] `scripts/release-package.sh` 里有一条会因 `T###` 而失败的检查，且拿这三处回归验证过它真的会红
- [ ] `pnpm test` + `pnpm typecheck` + `pnpm lint` 全绿

---

## 不新开卡：T1306 的删号外键方向

写进 [phase-13-acquisition.md](phase-13-acquisition.md) 的 T1306 卡（那一条本来就有「账户删除……不能级联删掉财务记录；实现前核对现有删除外键并补回归测试」）。

现状是：0017 建的两条外键**都**是 `on delete cascade`（`referral_codes.user_id`、`referral_relationships.inviter_user_id` 与 `invitee_user_id`），README 也写了「删除账号由外键级联清掉其邀请码与关系」。问题在于 `inviter_user_id` 那条：**邀请人**删号会把**受邀人**名下那一行一起删掉，而受邀人还在、账务引用还在 —— 这正是 T1306 卡要求保留的东西。方向必须在 T1306 开工第一件事定下来（软删还是 `set null` + 保留幂等键），并补回归测试；这期间真删号的邀请人，其受邀人的关系行已经补不回来了。
