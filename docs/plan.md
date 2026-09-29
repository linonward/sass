# 出海 SaaS 套件方案

状态：已确认并实施（2026-09-25 定稿；2026-09-29 更新：阶段 1–22 已落地，阶段 23 进行中）

## 目标

一个 GitHub 模板仓库（Next.js 单应用）。新项目点 "Use this template"，改 `site.config.ts` 和 `.env`，跑一次数据库迁移，就得到一个能登录、能付费、能扣积分、能调 AI、能上线的站点。之后只在约定目录里写业务代码。

**验收标准**：用本模板启动下一个真实项目，从 fork 到线上能收款 ≤ 1 天。

## 定位

先自用，服务接下来 2–3 个出海项目，用真实项目打磨。以后是否商业化，做完 2 个项目后再评估。v1 不承担产品化成本。

**2026-09-26 更新**：商业化提前启动——模板将直接售卖（阶段 8，见 [tasks/phase-8-sell.md](tasks/phase-8-sell.md)）。授权采用**专有 EULA**：买家可用模板构建不限数量的自有产品（可商用、闭源、改代码），但不得再分发 / 转售模板本身。v1 交付范围不变，商品化工作单列阶段 8。

## 范围

### v1 做

| 模块   | 选型                                                                                     |
| ------ | ---------------------------------------------------------------------------------------- |
| 框架   | Next.js App Router + TypeScript + pnpm                                                   |
| UI     | shadcn/ui + Tailwind，主题色由配置驱动                                                   |
| 多语言 | next-intl，默认只开 `en`，加语言 = 加一个 `messages/<locale>.json`                       |
| 落地页 | Hero / Features / Pricing / FAQ / CTA 区块，内容由配置和文案驱动                         |
| SEO    | metadata、sitemap、robots、OG 图、hreflang                                               |
| 法律页 | 隐私政策、服务条款（Creem 审核需要）                                                     |
| 数据库 | Neon Postgres + Drizzle ORM + drizzle-kit 迁移                                           |
| 认证   | Better Auth：Google OAuth + 邮箱验证码（`emailOTP` 插件，Resend 发送）；admin 插件管角色 |
| 邮件   | Resend + React Email                                                                     |
| 支付   | `PaymentProvider` 接口，三个适配器：Creem（默认）、Stripe、Lemon Squeezy                 |
| 积分   | Postgres 账本                                                                            |
| AI     | Vercel AI SDK                                                                            |
| 限流   | Upstash Redis + `@upstash/ratelimit`                                                     |
| 文件   | Cloudflare R2 预签名上传                                                                 |
| 博客   | content-collections + MDX                                                                |
| 后台   | 用户、订单、积分调整                                                                     |
| 部署   | Vercel + Neon                                                                            |
| 可观测 | 结构化日志 + OpenTelemetry、Sentry、Vercel Analytics、后台业务指标（阶段 6）             |

### v1 不做

CLI 生成器、npm 包 / monorepo、文档站、license 授权、多套 UI 主题、团队 / 组织 / 多租户、Cloudflare / Docker 部署、原生 App、营销邮件 / Resend Audiences、**独立的消息队列 / 工作流服务**（定时触发只用于恢复核对，见阶段 23）、Session 缓存。

## 架构

```
site.config.ts ──┐        .env（zod 校验，缺失即启动失败）
                 ▼
┌──────────────── src/core（套件维护，业务不改）─────────────────────┐
│ auth(Better Auth) ─ db(Drizzle+Neon) ─ email(Resend)              │
│ billing(PaymentProvider × 3) ──webhook──► credits(账本)            │
│ ai(AI SDK) ──扣积分──► credits    ratelimit(Upstash)              │
│ storage(R2)    admin                                               │
└────────────────────────────────────────────────────────────────────┘
                 ▲
src/features/*、src/app/[locale]/(app)/*、content/、messages/  ← 业务代码
```

依赖单向：billing → credits ← ai。credits 不反向调用 billing 或 ai，无环。

### 目录边界

| 路径                              | 归属 | 说明                                       |
| --------------------------------- | ---- | ------------------------------------------ |
| `src/core/**`                     | 套件 | 业务项目尽量不改，改了会增加合并上游的冲突 |
| `src/app/[locale]/(marketing)/**` | 套件 | 落地页、定价、法律页、博客路由             |
| `src/app/[locale]/(app)/**`       | 业务 | 登录后的业务页面                           |
| `src/features/**`                 | 业务 | 业务逻辑与组件                             |
| `site.config.ts`                  | 业务 | 品牌、域名、功能开关、套餐、限流阈值       |
| `messages/**`、`content/**`       | 业务 | 文案、博客文章                             |

业务项目用 `git remote add upstream <本仓库>` 合并套件更新，规则写进 `UPGRADING.md`。注意这条路径**只对从 git 仓库 fork 的项目成立**：走 zip 发行包的买家与模板没有共同 Git 历史，`git merge`（含 `--allow-unrelated-histories`）不能作为升级方案 —— 修复见阶段 23 的 T2301（版本基线 + 差量更新包 + 三路合并）。

## 关键决策

1. **模板仓库，不做包。** 自用阶段维护 npm 包的发版成本不值得。代价是上游更新靠 git merge，所以目录边界必须严守。
2. **模块开关放在配置里。** `site.config.ts` 的 `features: { credits, ai, blog, upload, admin, rateLimit, observability }` 控制路由、导航和 env 校验。关掉的模块不要求对应的 key。
3. **积分用账本。** `credit_transactions` 记流水，`user_credits.balance` 作余额缓存。扣减用 `UPDATE … SET balance = balance - n WHERE balance >= n` 保证原子性。需要事务的地方用 Neon WebSocket `Pool` 驱动（HTTP 驱动不支持交互式事务）。
4. **webhook 幂等。** `webhook_events` 表以 `(provider, event_id)` 做唯一约束，重复推送不重复发积分。
5. **支付回跳不依赖 webhook 已到。** 成功页轮询订单状态，webhook 未到时显示"处理中"。
6. **AI 计费 v1 按次固定扣费。** 每个模型每次调用的积分成本写在配置里。调用前预扣，失败时退回，写入账本并注明原因。按 token 计费不在 v1。
7. **邮箱登录用验证码，不用 magic link。** 验证码可以跨设备输入（电脑上登录、手机上看邮件），也不会被企业邮箱的链接扫描提前消耗。只维护一种邮箱登录方式。参数显式配置，不依赖插件默认值：6 位数字，5 分钟有效，最多尝试 3 次，重发冷却 60 秒。
8. **优先用官方和生态方案。** 实现时依赖版本以官方文档的最新稳定版为准，不凭记忆写。

### 邮件（Resend）

- 用于登录验证码和事务邮件：欢迎、支付成功、续费失败、积分不足。
- 模板放在 `src/core/email/templates/`，跟随用户 locale。
- 本地没配 `RESEND_API_KEY` 时，把邮件内容打印到控制台；生产环境缺 key 则启动失败。
- 发件人名称、发件地址、回复地址放在 `site.config.ts` 的 `email` 字段。
- 每个新项目都要在域名 DNS 里配置 Resend 的 SPF / DKIM 记录。

### Redis（Upstash，只做限流）

| 场景                       | 是否用 Redis                                                   |
| -------------------------- | -------------------------------------------------------------- |
| AI、上传预签名接口限流     | 是：按用户 + IP 的滑动窗口，阈值写在配置里                     |
| 登录、验证码发送与校验频率 | 否：用 Better Auth 自带的限流，存 Postgres                     |
| 积分余额                   | 否：必须和账本在同一个事务里                                   |
| Session 缓存、独立队列     | v1 不做（恢复与补发走 Postgres + 受保护的定时入口，见阶段 23） |

- 生产环境只要开了 `ai` 或 `upload`，就强制要求 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`。
- 本地未配置时跳过限流，并打印警告。
- Upstash 不可用时默认放行并记录错误日志（`rateLimit.failMode: "open"`），可切换成 `"closed"`。积分扣减是最后一道防线。

### 可观测性（阶段 6）

分四块，各自独立开关，关掉的部分不要求对应的 key：

| 块         | 选型                              | 回答的问题                             |
| ---------- | --------------------------------- | -------------------------------------- |
| 日志与追踪 | 结构化 JSON 日志 + `@vercel/otel` | 某个请求 / webhook / AI 调用发生了什么 |
| 错误追踪   | Sentry（`@sentry/nextjs`）        | 线上哪里报错、影响了谁                 |
| 流量与性能 | Vercel Analytics + Speed Insights | 谁来了、页面快不快                     |
| 业务指标   | `/admin/metrics`，直接查 Postgres | 注册、付费、MRR、积分和 AI 用量        |

- 总开关 `features.observability`；细项在 `site.config.ts` 的 `observability` 字段（`otel`、`sentry`、`analytics`、`speedInsights`）。
- `src/core` 里统一用 `logger`，不再直接 `console.error`。`logger.error` 是错误上报的唯一入口，开了 Sentry 就同时上报。
- 日志和上报都不带邮箱、token、支付信息等敏感字段；用户只记 ID。
- 业务指标跟随 `features.admin`，不依赖 `features.observability`，也不引入图表库。

### 获客（阶段 13，已规划）

2026-09-27 确认将三块通用获客能力纳入模板，任务见 [阶段 13](tasks/phase-13-acquisition.md)：

| 能力     | 首版范围                                                         | 任务        |
| -------- | ---------------------------------------------------------------- | ----------- |
| 渠道归因 | 30 天首次来源、UTM/来源域名、注册关联、渠道注册与收入报表        | T1301–T1302 |
| 线索收集 | 邮箱留资/候补名单、确认与撤回、注册关联、后台筛选及 CSV 导出     | T1303–T1304 |
| 邀请奖励 | 专属链接、新用户绑定、首次有效付款给双方积分、退款回收和后台审核 | T1305–T1306 |

三块默认关闭、可独立启用，复用现有数据库、邮件、认证、计费和积分。来源记录采用明确接受后的第一方 Cookie；邀请需访客接受后绑定。获客统计直接查 Postgres，不依赖 Vercel Analytics 自定义事件。新增能力属于阶段 13，不表示现有 v1 已交付；营销群发、自动培育、现金佣金与提现仍不在范围内。

实施先做归因与报表，再做线索，最后做邀请奖励；报表依赖 T1202 退款口径修复，奖励依赖 T1202 和 T1204 计费加固。详细数据口径、开关、删除/保留规则、验收和测试以阶段任务卡为准。

### 会话失效（阶段 17）

邮箱是找回账号的凭据，改邮箱、删账户这类操作必须让旧 session 立刻失效，否则改之前拿到 session 的人
（旧设备、被偷的 cookie）还能继续用旧身份访问。2026-09-28 的结论（T1703）：

- **能靠 Better Auth 自己全量失效。** 1.7.6 的 `internalAdapter.deleteUserSessions(userId)`（HTTP 端点
  `POST /revoke-sessions`，`auth.api.revokeSessions`）就是"踢掉该用户所有设备"，不需要
  `secondaryStorage`，也不需要绕过插件。任务卡里猜的 `session.allowedSubset` 不存在这个 API。
- **改邮箱成功后清全部 session。** 实现是 `src/core/auth/session-invalidation.ts` 里的插件，挂在
  emailOTP 的 `/email-otp/change-email` 端点之后，只在端点成功（`{ success: true }`）时动手 —— 端点是
  先更新邮箱再返回，中途失败（验证码错、新邮箱被占用）时 after 钩子照样会跑，所以必须看 `returned`
  而不能只看"钩子跑了"。当前设备也在被清之列，改完用新邮箱重新登录。
- **改邮箱要两个验证码。** `changeEmail.enabled` + `verifyCurrentEmail: true`：一个发到当前邮箱、一个
  发到新邮箱，开关写在 `site.config.ts` 的 `auth.changeEmail`。不要求验证当前邮箱的话，只偷到
  session cookie 就能把邮箱改成攻击者的地址，等于把账号交出去。两封邮件用同一个模板
  `change-email-code`（`forNewEmail` 区分收件人），文案在 `messages/*.json` 的 `Email.changeEmailCode`。
- **删账户本来就清了。** `session.userId` 是外键级联（`src/core/db/schema/auth.ts`），删 user 那一行时
  数据库把 session 一起删；浏览器里的 cookie 由 `deleteAccount`（`src/core/account/actions.ts`）清。
  不需要额外逻辑，只在 `delete-user.ts` 补了注释说明。
- **设置页暂时没有改邮箱入口。** 接口能用（e2e 直接调接口覆盖），UI 属于后续任务；核心插件的链接式
  `/change-email`（`user.changeEmail.enabled`）在本仓库保持关闭。

### 交付与恢复（阶段 23，进行中）

2026-09-29 定：目标用户固定为**使用 Next.js、需要积分收费的中文独立开发者**，暂停扩充通用功能，用三周把「别人能买、能升级、出问题能自己查」补完。任务见 [阶段 23](tasks/phase-23-delivery.md)。

| 批次     | 内容                                                         | 任务        |
| -------- | ------------------------------------------------------------ | ----------- |
| 交付基础 | 落卡与文档修正、买家升级路径、买家 agent 指引                | T2300–T2302 |
| 恢复能力 | AI 任务服务端推进与核对、计费异常台、事务邮件持久化重试      | T2303–T2305 |
| 真实交付 | 参考产品、首个候选发行包（版本/许可/支持范围）、外部买家试用 | T2306–T2308 |

四条约束（写在阶段文档开头，也写进各卡）：

- **不引入独立队列服务**：沿用 TypeScript + Node + Postgres，恢复靠「受保护的 HTTP 入口 + 任何调度器都能调它」，触发频率由部署方式决定（Vercel Hobby 的 cron **每天只能跑一次**，必须有兜底）。
- **超时只表示需要核对，不等于失败**：先去供应商侧核对，能拿到结果就先保存结果，不许「等太久了所以判失败并退款」。
- **随包交付的文件不能引用任务卡，也不能指向未随包交付的文件**（排除清单在 `scripts/release-package.sh`）。
- **结算类改动必须同时检查订单、任务、积分流水三处状态**，页面提示与日志不算证据。

需要外部输入（阻塞 T2307 / T2308）：发行主体与支持邮箱、三家支付商与模型服务商的测试环境账号、3 位试用用户。

## 风险

- **最脆弱的假设**：业务代码遵守目录边界。一旦大量改动 `src/core`，上游更新就合不回去。缓解：`UPGRADING.md` 写明目录边界，`scripts/core-drift.sh` 给出冲突报告（**目前只手工跑，没接进 CI**），以及阶段 23 的差量更新流程（T2301）—— 它让「模板改了、买家也改了」显式暴露成冲突，而不是被整份覆盖。
- **外部服务失效**：支付商 webhook 延迟时，靠轮询 + 幂等；Upstash 挂掉时放行 + 积分兜底；Resend 挂掉时验证码发不出，页面提示稍后重试，并引导用户改用 Google 登录 —— 持久化重试由阶段 23 的 T2305 补上。AI 供应商侧超时不等于失败，先核对再判定（T2303）。
- **回滚**：全新仓库，没有现存数据，每个 PR 都能单独 revert。

## 测试

- **Vitest**：积分扣减（余额充足、余额不足、并发）、webhook（签名错误、重复事件、未知类型）、env 校验（关闭模块后不再要求 key）、限流（超阈值返回 429、Redis 不可用时的行为）。三家适配器各有单测；阶段 23 再加恢复扫描与异常处理的库测试（用户关掉页面、进程重启、并发结算、退款事务失败重放）。
- **Playwright 冒烟**：落地页多语言切换 → 邮箱验证码登录（测试环境从 `.tmp/emails/` 读取验证码）→ 用 `BILLING_PROVIDER=fake` 的站内假服务商结账 → 积分到账 → 调一次 AI 并扣积分。**假服务商只覆盖流程，不覆盖真实服务商的字段与签名**；真实测试环境的验证结果记在阶段 23 的 T2306 / T2307。

## 外部依赖

| 服务                            | 首次需要                      |
| ------------------------------- | ----------------------------- |
| GitHub、Vercel、域名            | T108                          |
| Neon                            | T201                          |
| Resend（需验证域名）            | T202                          |
| Google Cloud OAuth Client       | T203                          |
| Creem（先用测试模式）           | T302                          |
| Upstash Redis                   | T401                          |
| AI 服务商 key（至少一个）       | T402                          |
| Cloudflare R2                   | T403                          |
| Sentry（可选）                  | T602                          |
| Stripe / Lemon Squeezy 测试账号 | T2306（真实测试环境验证）     |
| 发行主体与支持邮箱              | T2307（`LICENSE` 与支持范围） |
| 试用用户（3 位）                | T2308                         |

## 推迟项

- ~~**Stripe 适配器**：等有海外公司主体时再做。~~ 已实现（T1801；Lemon Squeezy 见 T1802）。真实测试环境的验证结果仍待补，见阶段 23 的 T2306 / T2307。
- **是否商业化**：~~做完 2 个项目后用 `/office-hours` 评估。~~ 已提前决策（2026-09-26）：直接售卖，商品化工作见阶段 8。正式售卖的门槛见阶段 23（T2308 的五条放行条件）。
