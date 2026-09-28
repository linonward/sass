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
- **范围**: `src/core/billing/providers/stripe/`
- **做什么**:
  - 实现 `PaymentProvider` 接口：`createCheckout`、`createPortal`、`verifyWebhook`、`parseWebhookEvent`
  - 用 Stripe SDK（`stripe` npm 包）对接 Payment Intents + Customer Portal
  - Webhook handler：`checkout.session.completed`、`customer.subscription.updated/deleted`、`invoice.paid/payment_failed`
  - `site.config.ts` 加 `stripe` provider 选项（`billing.provider: "stripe"`）
  - 环境变量：`STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`、`STRIPE_PRODUCT_ID_PRO` 等
  - 与现有 Creem fake provider 保持接口一致：测试里 mock Stripe API
- **验证**:
  - adapter 单测：checkout 创建、webhook 验签、事件解析
  - e2e（fakestripe 模式）：checkout → webhook → credits granted 全流程
  - CI env: `BILLING_PROVIDER=stripe` + Stripe test keys → 全链路

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
