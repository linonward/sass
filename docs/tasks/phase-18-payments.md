# 阶段 18：支付商扩展

当前只有 Creem。`PaymentProvider` 接口（`src/core/billing/provider.ts`）已经定义了 adapter 契约，加新支付商就是写一个新 adapter + 一套 webhook handler。

## 依赖

T1704（CI 依赖审计）完成后，新加的依赖不会引起 audit 告警。两个 adapter 互不依赖，可并行。

```
T1704 → T1801
      → T1802
T1801, T1802 → T1803
```

## 任务

### T1801: Stripe adapter

- **topic**: `stripe`
- **分支**: `feat/stripe`
- **范围**: `src/core/billing/providers/stripe.ts`（+ `src/app/api/webhooks/stripe/route.ts`、注册表 `providers/index.ts`、`src/core/billing/env.ts`、`site.config.ts`）
- **做什么**:
  - 实现 `PaymentProvider` 接口：`createCheckout`、`getPortalUrl`、`cancelSubscription`、`verifyWebhook`、`parseEvent`
  - 用官方 `stripe` npm SDK 对接 **Checkout Sessions（服务商托管结账页）** + Billing Portal；不用 Payment Intents + Elements（模板不内嵌支付组件，`createCheckout` 仍然只返回 `{ checkoutId, url }`）
  - 两条 webhook 路由并存，未生效的服务商那条返回 503：`/api/webhooks/stripe` 处理 `checkout.session.completed`、`invoice.paid`、`invoice.payment_failed`、`customer.subscription.updated/deleted`
  - 支付商注册表（T1802 只需加一个枚举值和一个 `case`）：`billingProviderNames`、`billingServerEnv({ hasPaidPlans, provider })`、`providers/index.ts` 按 `BILLING_PROVIDER` 分派
  - `site.config.ts` 加 `stripe` provider 选项；产品 ID 的环境变量**按服务商加前缀**：`STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`、`STRIPE_PRICE_ID_PRO` / `STRIPE_PRICE_ID_LIFETIME`（Creem 的 `CREEM_PRODUCT_ID_*` 不变）
  - fake 闸门加第三条硬锁：配了 live 的 Stripe 密钥（`sk_live_` / `rk_live_`）时不允许 `BILLING_PROVIDER=fake`
  - v1 不处理退款（Stripe 的退款对象没有发票字段，细节写在 adapter 顶部注释和 README 里）
- **验证**:
  - adapter 单测（`src/core/billing/providers/stripe.test.ts`）：用官方文档的示例 payload 当 fixture、注入假的 SDK client；签名校验用真实 SDK 的 `webhooks.generateTestHeaderString` 离线签，**不联网、不需要任何真实 key**
  - 全链路（checkout → webhook → 发积分）仍由 fake provider 的 e2e 保证：`BILLING_PROVIDER=fake` 跑 `e2e/billing.spec.ts`
  - CI 不引入 Stripe 真实 key、不依赖网络；**真实 test mode 下单 + 真实 webhook 投递不做**，该路径未验证

### T1802: LemonSqueezy adapter

- **topic**: `lemonsqueezy`
- **分支**: `feat/lemonsqueezy`
- **范围**: `src/core/billing/providers/lemonsqueezy/`
- **做什么**:
  - 实现 `PaymentProvider` 接口
  - 用 `@lemonsqueezy/lemonsqueezy.js` SDK
  - Webhook handler：`order_created`、`subscription_payment_success`、`subscription_cancelled`
  - `site.config.ts` 加 `lemonsqueezy` 选项
  - 环境变量：`LEMONSQUEEZY_API_KEY`、`LEMONSQUEEZY_WEBHOOK_SECRET`、`LEMONSQUEEZY_STORE_ID` 等
- **验证**: 同 T1801 的 adapter 单测 + e2e 模式

### T1803: 支付商选型文档

- **topic**: `billing-docs`
- **分支**: `docs/billing`
- **范围**: `docs/billing.md`（新建）
- **做什么**:
  - 对比 Creem / Stripe / LemonSqueezy：适合场景、费用、支持地区、MoR 状态
  - 切换指南：改 `site.config.ts` 两个字段 + 设对应环境变量
  - 加新支付商的 checklist（实现 `PaymentProvider` → webhook → env schema → 测试 → 文档）
- **验证**: 文档里每个 provider 的示例可复制粘贴运行

## 完成后

- 用户可以在三个支付商之间选（Creem/Stripe/LemonSqueezy）
- 切换成本：改配置 + 设环境变量
- 加第四个支付商的路径文档化了
