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
  - 实现 `PaymentProvider` 接口：`createCheckout`、`getPortalUrl`、`cancelSubscription`、`verifyWebhook`、`parseEvent`
  - 手写薄 HTTP 客户端对接 JSON:API v1（`POST /v1/checkouts`、`GET /v1/customers/:id`、`GET|DELETE /v1/subscriptions/:id`），**不引 `@lemonsqueezy/lemonsqueezy.js`**：该 SDK 自 2024-11-05 起没有再发版，若干接口长期是坏的，而这里要的只是四个调用；客户端只有几十行、fetch 可注入，顺带不动 `package.json` / `pnpm-lock.yaml` / `THIRD-PARTY-NOTICES.md`
  - Webhook handler：`/api/webhooks/lemonsqueezy`，验签用原始请求体的 HMAC-SHA256 十六进制（`X-Signature`）；事件映射表写在 `providers/lemonsqueezy.ts` 顶部，订阅类事件按 `attributes.status` 分派（不按事件名），退款只在能证明是**全额**退款时映射
  - `site.config.ts` 加 `lemonsqueezy` 选项（`billing.provider`）；该服务商下 `providerProductId` 填**变体 ID**，产品 ID 的环境变量前缀是 `LEMONSQUEEZY_VARIANT_ID_*`
  - 环境变量：`LEMONSQUEEZY_API_KEY`、`LEMONSQUEEZY_WEBHOOK_SECRET`、`LEMONSQUEEZY_STORE_ID`；`BILLING_PROVIDER` 不填时默认取站点配置的 provider
- **验证**:
  - adapter 单测：官方示例 payload 当 fixture（`providers/__fixtures__/lemonsqueezy-webhooks.json`）+ 注入的假 fetch，覆盖验签、全部事件映射、`createCheckout` 请求体、门户地址（含 LS 返回 null 的分支）、取消订阅幂等、结构不对的 payload 返回 null
  - `checkout → webhook → credits` 全链路仍由现成的 fake provider e2e（`BILLING_PROVIDER=fake`）覆盖，不新增服务商专属 e2e 模式
  - CI 里不引入任何真实密钥、不依赖外网
  - 真实密钥的端到端（LS test mode 真实下单 + 真实 webhook）**不做**，也不进 CI

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
