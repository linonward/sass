# 阶段 3：收款

阶段完成后：可以做能收钱的 SaaS。

---

## T301 billing-core

- 分支 / worktree：`feat/billing-core` → `../sass-billing-core`
- 依赖：T201

**做**

- `src/core/billing/provider.ts`：定义 `PaymentProvider` 接口，包含：
  - `createCheckout({ userId, planId, successUrl, cancelUrl })`
  - `getPortalUrl(customerId)`
  - `cancelSubscription(subscriptionId)`
  - `verifyWebhook(request)`
  - `parseEvent(payload)`：返回归一化的 `BillingEvent`
- `BillingEvent` 类型：`checkout.completed`、`subscription.active`、`subscription.renewed`、`subscription.canceled`、`subscription.expired`、`payment.failed`、`refund.created`
- 新增的表：
  - `billing_customers`
  - `subscriptions`
  - `orders`
  - `webhook_events`：`(provider, event_id)` 唯一

  这些表只使用通用字段，服务商的原始数据存在 `raw jsonb` 里

- `handleBillingEvent(event)`：在一个事务里完成三件事：幂等检查、更新订阅和订单状态、触发 `onBillingEvent` 钩子
- 在配置中加入 `billing.plans` 的交易字段：`type`（`subscription` 或 `one_time`）、`interval`、`providerProductId`、`credits`
- 测试用的 `FakeProvider`

**不做**：任何真实的支付服务商

**验收**

- [ ] 每种 `BillingEvent` 都能正确更新订阅或订单状态
- [ ] 同一事件处理两次，结果与处理一次相同

**测试**：用 Vitest 配合 `FakeProvider`，覆盖全部事件类型，外加重复事件和乱序事件（例如 `renewed` 先于 `active` 到达）

---

## T302 credits

- 分支 / worktree：`feat/credits` → `../sass-credits`
- 依赖：T201

**做**

- 新增的表：
  - `user_credits`：余额缓存
  - `credit_transactions`：流水，包含 `type`（`grant` / `deduct` / `refund` / `adjust`）、`amount`、`reason`、`source`、`source_id`；`(source, source_id)` 唯一，用于幂等
- API 放在 `src/core/credits/`：
  - `getBalance`
  - `grantCredits`
  - `deductCredits`：余额不足时抛出 `InsufficientCreditsError`
  - `refundCredits`
  - `listTransactions`
- 扣减用原子 SQL：`UPDATE … SET balance = balance - n WHERE balance >= n`，余额更新和写流水放在同一个事务里
- v1 的积分只累加、不过期；订阅续费时再发放一次
- 由 `features.credits` 控制是否启用

**不做**：积分过期、按 token 计费

**验收**

- [ ] 50 个并发扣减请求下，余额不会变成负数，流水总和等于余额
- [ ] 同一个 `source_id` 重复发放，积分只到账一次

**测试**：在真实 Postgres 上跑 Vitest，覆盖并发、余额不足、幂等、退款

---

## T303 creem

- 分支 / worktree：`feat/creem` → `../sass-creem`
- 依赖：T301、T302、T203
- 外部依赖：Creem（先用测试模式）

**做**

- `src/core/billing/providers/creem.ts`：用 Creem 官方 SDK 实现 `PaymentProvider`，事件映射以官方文档为准
- 路由：
  - `POST /api/billing/checkout`：需要登录
  - `GET /api/billing/portal`：需要登录
  - `POST /api/webhooks/creem`：验证签名，并交给 `handleBillingEvent`
- 挂载 `onBillingEvent` 钩子：套餐配置了 `credits` 且 `features.credits` 开启时，调用 `grantCredits`，`source_id` 使用订单 ID 或账期 ID
- 挂载 `onUserDelete` 钩子：用户删除账户时取消其有效订阅
- 在 env 中加入 `CREEM_API_KEY`、`CREEM_WEBHOOK_SECRET`，以及测试或生产模式的开关
- 在 README 的上线清单里加入：在 Creem 创建产品、配置 webhook 地址、从测试模式切到生产模式

**不做**：定价页的 UI（放在 T304）

**验收**

- [ ] 在 Creem 测试模式下完成一次订阅和一次一次性付款，数据库状态和积分都正确
- [ ] 签名错误的请求返回 401，重复推送的事件不产生副作用

**测试**：Vitest 用 Creem 官方文档中的示例 payload 覆盖签名验证和事件映射；支付全流程做人工验证

---

## T304 pricing

- 分支 / worktree：`feat/pricing` → `../sass-pricing`
- 依赖：T303、T105

**做**

- `/pricing` 页面和落地页的 Pricing 区块都接上结账：未登录时先登录，登录后回到结账
- `/billing/success`：轮询订单状态，webhook 还没到时显示"处理中"，超过 60 秒显示联系支持
- Dashboard 的账单页：当前套餐、续费日期、"管理订阅"（跳转客户门户）、积分余额、最近 20 条流水

**不做**：发票下载（由 Creem 客户门户提供）

**验收**

- [ ] 从落地页点击购买到回到成功页的流程顺畅
- [ ] webhook 延迟时，成功页不报错，状态最终会更新

**测试**：e2e 用 `FakeProvider` 模拟整条流程，包括 webhook 延迟的情况

---

## T305 billing-emails

- 分支 / worktree：`feat/billing-emails` → `../sass-billing-emails`
- 依赖：T303、T202

**做**

- 新增模板：`payment-succeeded`、`payment-failed`、`subscription-canceled`、`credits-low`
- 前三个由 `onBillingEvent` 钩子触发
- `credits-low`：扣减后余额跨过 `credits.lowBalanceThreshold` 时发送；同一用户 24 小时内最多发一次

**不做**：营销类邮件

**验收**

- [ ] 在测试模式下每种事件都会发出对应邮件
- [ ] `credits-low` 不会重复轰炸用户

**测试**：Vitest 配合 `EMAIL_TRANSPORT=file`，断言邮件已发出、内容正确，并验证去重
