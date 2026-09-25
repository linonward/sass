# 出海 SaaS 套件方案

状态：已确认，待实施（2026-09-25）

## 目标

一个 GitHub 模板仓库（Next.js 单应用）。新项目点 "Use this template"，改 `site.config.ts` 和 `.env`，跑一次数据库迁移，就得到一个能登录、能付费、能扣积分、能调 AI、能上线的站点。之后只在约定目录里写业务代码。

**验收标准**：用本模板启动下一个真实项目，从 fork 到线上能收款 ≤ 1 天。

## 定位

先自用，服务接下来 2–3 个出海项目，用真实项目打磨。以后是否商业化，做完 2 个项目后再评估。v1 不承担产品化成本。

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
| 支付   | `PaymentProvider` 接口，v1 只实现 Creem                                                  |
| 积分   | Postgres 账本                                                                            |
| AI     | Vercel AI SDK                                                                            |
| 限流   | Upstash Redis + `@upstash/ratelimit`                                                     |
| 文件   | Cloudflare R2 预签名上传                                                                 |
| 博客   | content-collections + MDX                                                                |
| 后台   | 用户、订单、积分调整                                                                     |
| 部署   | Vercel + Neon                                                                            |
| 可观测 | 结构化日志 + OpenTelemetry、Sentry、Vercel Analytics、后台业务指标（阶段 6）             |

### v1 不做

CLI 生成器、npm 包 / monorepo、文档站、license 授权、多套 UI 主题、团队 / 组织 / 多租户、Stripe 适配器（只留接口）、Cloudflare / Docker 部署、原生 App、营销邮件 / Resend Audiences、队列与定时任务、Session 缓存。

## 架构

```
site.config.ts ──┐        .env（zod 校验，缺失即启动失败）
                 ▼
┌──────────────── src/core（套件维护，业务不改）─────────────────────┐
│ auth(Better Auth) ─ db(Drizzle+Neon) ─ email(Resend)              │
│ billing(PaymentProvider→Creem) ──webhook──► credits(账本)         │
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

业务项目用 `git remote add upstream <本仓库>` 合并套件更新，规则写进 `UPGRADING.md`。

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

| 场景                       | 是否用 Redis                               |
| -------------------------- | ------------------------------------------ |
| AI、上传预签名接口限流     | 是：按用户 + IP 的滑动窗口，阈值写在配置里 |
| 登录、验证码发送与校验频率 | 否：用 Better Auth 自带的限流，存 Postgres |
| 积分余额                   | 否：必须和账本在同一个事务里               |
| Session 缓存、队列         | v1 不做                                    |

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

## 风险

- **最脆弱的假设**：业务代码遵守目录边界。一旦大量改动 `src/core`，上游更新就合不回去。缓解：在 T503 加 `UPGRADING.md`，并用 lint 规则标记业务项目对 `src/core` 的改动。
- **外部服务失效**：Creem webhook 延迟时，靠轮询 + 幂等；Upstash 挂掉时放行 + 积分兜底；Resend 挂掉时验证码发不出，页面提示稍后重试，并引导用户改用 Google 登录。
- **回滚**：全新仓库，没有现存数据，每个 PR 都能单独 revert。

## 测试

- **Vitest**：积分扣减（余额充足、余额不足、并发）、webhook（签名错误、重复事件、未知类型）、env 校验（关闭模块后不再要求 key）、限流（超阈值返回 429、Redis 不可用时的行为）。
- **Playwright 冒烟**：落地页多语言切换 → 邮箱验证码登录（测试环境从 `.tmp/emails/` 读取验证码）→ Creem 测试模式付款 → 积分到账 → 调一次 AI 并扣积分。

## 外部依赖

| 服务                      | 首次需要 |
| ------------------------- | -------- |
| GitHub、Vercel、域名      | T108     |
| Neon                      | T201     |
| Resend（需验证域名）      | T202     |
| Google Cloud OAuth Client | T203     |
| Creem（先用测试模式）     | T302     |
| Upstash Redis             | T401     |
| AI 服务商 key（至少一个） | T402     |
| Cloudflare R2             | T403     |
| Sentry（可选）            | T602     |

## 推迟项

- **Stripe 适配器**：等有海外公司主体时再做。
- **是否商业化**：做完 2 个项目后用 `/office-hours` 评估。
