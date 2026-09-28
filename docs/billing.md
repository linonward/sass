# 支付服务商

模板出厂用 **Creem**，另外实现了 **Stripe** 和 **Lemon Squeezy**。三家实现同一个 `PaymentProvider` 接口（`src/core/billing/provider.ts`），共用同一套结账、webhook、订单表、积分发放和后台统计 —— 换服务商不碰业务代码，改 `site.config.ts` 的两处字段、再设一组环境变量即可。

本文只讲**选谁、怎么换、怎么加第四个**。每个服务商从零到真实收款的逐条操作在 README 的[上线清单](../README.md#上线清单)里（[支付（Creem / Stripe）](../README.md#支付creem--stripe)、[支付（Lemon Squeezy）](../README.md#支付lemon-squeezy)），本文不重复。

> 费率、支持地区、MoR 状态这些外部事实随时会变。本文核对日期 **2026-09**，给的是结构、量级和判断依据；具体数字以各节链接的官方页面为准。

## 怎么选

三家的定位差别比费率差别更大：

- **Creem**（出厂默认）：MoR，中国大陆卖家能注册、提现还有支付宝通道，审核通常 1–2 天。费率居中（3.9% + $0.40，高于 Stripe、低于 Lemon Squeezy），买到的是 MoR 的税务、退款和拒付代管 —— 个人和小团队最快能真实收款的一条路。
- **Stripe**：费率最低（美国区 2.9% + 30¢）、工具链最全（Billing、Tax、Invoicing、Radar），但**标准模式不是 MoR** —— 增值税 / 销售税要你自己注册、申报、缴纳。适合已经有香港 / 新加坡 / 美国等海外主体、愿意把支付栈握在自己手里的团队。
- **Lemon Squeezy**：MoR，买家支付方式最多（含支付宝、微信、银联）。费率三家最高（5% + 50¢）。但 Stripe 已在 2024 年收购它，官方 2026 年 1 月的口径是「目标是让 Lemon Squeezy 用户迁移到 Stripe Managed Payments」，并承认支持响应和产品更新变慢。现在选它没有问题，但要按「这家几年内可能被整合掉」来预期 —— 好在换服务商只要改两处配置（见下文）。

| 你的情况                                      | 选                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------ |
| 个人 / 小团队，不想碰税务合规，想最快真实收款 | Creem                                                              |
| 中国大陆卖家                                  | Creem（提现可走支付宝）                                            |
| 已有海外主体，想自己掌控支付栈、要最低费率    | Stripe                                                             |
| 想让买家能用 PayPal / 支付宝 / 微信 / 银联    | Lemon Squeezy（注意：订阅只支持卡、Apple Pay、Google Pay、PayPal） |

## 三家对比

下表数字核对于 **2026-09**，出处是各家官方页面（列在表后）。费率随国家、支付方式、商品类型变化，**签约前以官方页面为准**。

|                   | Creem                                                       | Stripe                                                                                  | Lemon Squeezy                                                                                                                        |
| ----------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 交易费            | 3.9% + $0.40                                                | 2.9% + 30¢（美国区；香港 3.4% + HK$2.35、新加坡 3.4% + S$0.50）                         | 5% + 50¢                                                                                                                             |
| 订阅附加费        | 无                                                          | Stripe Billing 按量 0.7%，或包月 $620/月起                                              | 订阅付款 +0.5%                                                                                                                       |
| 国际卡 / 货币转换 | 货币转换费未公布具体数字                                    | 国际卡 +1.5%、货币转换 +1%（美国区；香港、新加坡的货币转换是 +2%）                      | 国际卡 +1.5%、PayPal 交易 +1.5%                                                                                                      |
| 提现费            | 银行转账 $7 或 1% 取高；USDC 2%                             | 按国家和方式而定                                                                        | 美国银行免费，非美国 1%；PayPal 通道非美国 3%（单笔上限 $30）                                                                        |
| 拒付费            | $25 / 笔                                                    | $15 / 笔（香港 HK$85）                                                                  | $15 / 笔                                                                                                                             |
| 月费              | 无                                                          | 无（Billing、Tax、自定义域名等增值项另计）                                              | 无                                                                                                                                   |
| MoR               | 是                                                          | 标准模式**不是**；Managed Payments 是（在标准费率上再 +3.5%）                           | 是                                                                                                                                   |
| 卖家可用地区      | 87 个国家 / 地区，**含中国大陆、香港、新加坡**              | 支持列表含香港、新加坡，**不含中国大陆**；Managed Payments 亚太只开放 AU / HK / JP / SG | 银行提现约 120 国含香港、新加坡、澳门、台湾，**中国大陆不在银行提现列表**；PayPal 通道 200+                                          |
| 买家支付方式      | 卡、Apple Pay、Google Pay                                   | 取决于你的 Stripe 配置                                                                  | 卡（含银联）、PayPal、Apple Pay、Google Pay、支付宝、微信支付、Cash App Pay、银行借记；**订阅只有卡、Apple Pay、Google Pay、PayPal** |
| 上线审批          | KYC / KYB 人工审核 24–48 小时（高峰 72 小时），被拒不能复审 | 标准模式无需人工审核                                                                    | 激活问卷 + 身份验证，约 2–3 个工作日                                                                                                 |

出处：[creem.io/pricing](https://www.creem.io/pricing)、[docs.creem.io 财务文档](https://docs.creem.io/merchant-of-record/finance/payouts.md)、[Creem 支持国家](https://docs.creem.io/merchant-of-record/supported-countries)；[stripe.com/pricing](https://stripe.com/pricing)、[stripe.com/global](https://stripe.com/global)、[Managed Payments 资格](https://docs.stripe.com/payments/managed-payments/eligibility)、[Stripe Billing 定价](https://stripe.com/billing/pricing)；[lemonsqueezy.com/pricing](https://www.lemonsqueezy.com/pricing)、[LS 费率](https://docs.lemonsqueezy.com/help/getting-started/fees)、[LS 支持国家](https://docs.lemonsqueezy.com/help/getting-started/supported-countries)、[LS 收款](https://docs.lemonsqueezy.com/help/getting-started/getting-paid)。

三条表里放不下、但会影响决策的事实：

- **Stripe 的费率随卖家所在国家变**，上表用的是美国区；香港、新加坡的卡费都是 3.4% + 本地货币小额。跨境和货币转换附加也按地区不同。
- **Managed Payments 的商家国清单官方没有给全**：资格页列出的是亚太 AU / HK / JP / SG、北美 CA / US，加一批欧洲国家（LS 的官方博客说「35+ 国」）—— **中国大陆主体开不了**。更要注意的是它的**买家侧受限地区包含中国大陆**：你的大陆客户在 Managed Payments 下买不了。
- **Lemon Squeezy 的订阅周期上限 1 年**，且订阅付款方式只有卡、Apple Pay、Google Pay、PayPal 四种（支付宝 / 微信等只支持一次性付款）。

## MoR 是什么

Merchant of Record（记录商户，MoR）是**法律意义上的卖方**：买家付款给 MoR，MoR 再跟你结算。它替你承担：

- **全球税务**：按买家所在地计算、代收、申报、缴纳 VAT / GST / 销售税（Creem 称覆盖 190+ 国家；Stripe Managed Payments 称 80+ 国家）。
- **退款与拒付**：由 MoR 处理，拒付责任也在它 —— Lemon Squeezy 文档原话是 "Generally, Lemon Squeezy is responsible for handling any chargebacks made against your sales"。
- 合规发票和 PCI 合规。

反过来，**非 MoR（标准 Stripe）意味着这些都是你的责任**：自己去每个有客户的辖区注册税号、申报、缴纳。Stripe Tax 只负责算税和代收（Basic 版 0.5% / 交易或 50¢ / 交易），**不含申报**；要代注册代申报得买 Tax Complete，起价 $90/月。标准 Stripe 便宜出来的那两三个点，很大程度是「这些活你自己干」换来的。

判断依据是官方原话，不用猜：Creem 和 Lemon Squeezy 都在文档里明确自称 merchant of record；Stripe 的 SSA 第 7.3(b) 条规定用户自行 "assessing, collecting, reporting, and remitting Taxes"，其对比文档把 "Merchant of record" 一行写成 **Managed Payments → Stripe；其他 Stripe 产品 → Your business**。

（Lemon Squeezy 的条款用的是 "non-exclusive reseller" 措辞，法律含义相同。）

出海 SaaS 用 MoR 的主要收益是**省掉税务合规的人力**：不必在每个有客户的国家注册税号、盯申报截止日。代价是费率高 1–3 个百分点，且你和买家之间隔了一层。

## 三家在站内的真实差异

选型时最容易被忽略的是「同一个接口之下，三家的行为并不完全一样」。下面这些差异全部来自本模板的实现，直接决定你的运营动作：

|                | Creem                                | Stripe                                                               | Lemon Squeezy                                                             |
| -------------- | ------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 产品 ID 含义   | 产品 ID（`prod_`）                   | Price ID（`price_`）                                                 | 变体 ID（variant）                                                        |
| 变量前缀       | `CREEM_PRODUCT_ID_*`                 | `STRIPE_PRICE_ID_*`                                                  | `LEMONSQUEEZY_VARIANT_ID_*`                                               |
| 结账页取消地址 | 不支持，用户关掉页面即可             | 支持 `cancel_url`                                                    | 不支持，用户关掉页面即可                                                  |
| 客户门户       | `customers.generateBillingLinks`     | Billing Portal 会话，要传 `return_url`；首次需在后台保存一次门户配置 | 读客户的 `customer_portal` 地址，**只在客户有生效订阅时才有值**，否则报错 |
| 删号时取消订阅 | 立即取消                             | 立即取消                                                             | 只停掉后续扣款，用户可以用到 `ends_at`                                    |
| 退款回收积分   | 按已退比例回收（`refund.created`）   | **不回收**：退款对象上没有发票字段，v1 忽略退款事件                  | **只回收全额退款**，部分退款不回收                                        |
| 测试 / 生产    | `CREEM_MODE=test` / `live`，两个域名 | 密钥本身区分（`sk_test_` / `sk_live_`）                              | 店铺上的一个开关，密钥不区分                                              |
| fake 硬锁      | `CREEM_MODE=live` 时拒绝             | 配了 `sk_live_` / `rk_live_` 时拒绝                                  | 没有：造不出可靠判据，见 `src/core/billing/env.ts` 的注释                 |

退款那一行是**真金白银的差别**，值得单独读一遍 README 的[收入口径](../README.md#收入口径)和对应服务商的上线清单小节：Creem 会按比例自动回收集分；Stripe 完全不管（退款只在后台做，积分要人工处理）；Lemon Squeezy 只认全额退款。

## 换一个支付商

前提：目标服务商的账号和产品已经开好（步骤见 README 上线清单的对应小节，含 webhook 地址、事件清单、测试卡）。

1. **改 `site.config.ts`**：把 `billingProvider` 的字面量改成目标服务商，并把两个付费套餐的 `providerProductId` 换成新服务商那边的对象 ID（Creem 产品、Stripe Price、Lemon Squeezy 变体）。

   ```ts
   const billingProvider: BillingProviderName = "stripe";
   ```

   `billingProvider` 也可以被运行时的 `BILLING_PROVIDER` 覆盖，两边都改最不容易忘；产品 ID 的环境变量前缀跟着**生效**的服务商走，所以选 Stripe 时 `CREEM_PRODUCT_ID_*` 会被忽略。

2. **设环境变量**。切换后要的是一整套新变量（变量名以 `.env.example` 为准）：

   ```bash
   # Stripe：生效服务商 + 密钥 + 产品 ID
   BILLING_PROVIDER=stripe
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   STRIPE_PRICE_ID_PRO=price_...
   STRIPE_PRICE_ID_LIFETIME=price_...
   ```

   ```bash
   # Lemon Squeezy：多一个 STORE_ID（建结账会话必须带 store 关系）
   BILLING_PROVIDER=lemonsqueezy
   LEMONSQUEEZY_API_KEY=...
   LEMONSQUEEZY_WEBHOOK_SECRET=...
   LEMONSQUEEZY_STORE_ID=...
   LEMONSQUEEZY_VARIANT_ID_PRO=...
   LEMONSQUEEZY_VARIANT_ID_LIFETIME=...
   ```

   ```bash
   # Creem：出厂默认。切回来时记得 CREEM_MODE 在真实收款前要设成 live
   BILLING_PROVIDER=creem
   CREEM_API_KEY=...
   CREEM_WEBHOOK_SECRET=...
   CREEM_PRODUCT_ID_PRO=prod_...
   CREEM_PRODUCT_ID_LIFETIME=prod_...
   CREEM_MODE=test
   ```

   只填**生效**服务商那一组：Vercel 生产环境缺了生效服务商的密钥，构建会直接失败（`src/core/billing/env.ts` 的 `billingServerEnv` 只在「Vercel 生产 + 站点有付费套餐 + 生效服务商是它」时要求必填）；本地不会，缺 key 的后果是结账和 webhook 返回 503，其他功能照常。

3. **在新服务商后台加 webhook 端点**，指向 `https://<你的域名>/api/webhooks/<服务商>`。事件要勾哪些、签名密钥在哪拿、本地怎么转发，都在 README 上线清单的对应小节里写好了 —— 漏勾事件不会报错，只会静默漏账。

4. **验证**：单元测试 + 站内的完整购买链路。

   ```bash
   pnpm test   # adapter 单测，用官方示例 payload 当 fixture，不联网、不需要真实密钥
   ```

   ```bash
   # 完整链路（结账 → webhook → 发积分）用站内的 fake 服务商跑，与具体服务商无关：
   EMAIL_TRANSPORT=file E2E_PORT=3100 \
     BILLING_PROVIDER=fake BILLING_SUCCESS_TIMEOUT_MS=8000 \
     CREEM_PRODUCT_ID_PRO=prod_ci_fake_pro CREEM_PRODUCT_ID_LIFETIME=prod_ci_fake_lifetime \
     npx playwright test e2e/pricing.spec.ts
   ```

   `E2E_PORT` 换一个端口，免得复用你正在跑的 `pnpm dev`。真实服务商的测试模式下单要自己在新服务商后台走一遍（README 上线清单里有测试卡号），本模板不做这件事的自动化。

### 切换前先处理存量订阅

同时只有一家服务商生效，**旧服务商的 webhook 路由在切换后一律返回 503**（`billing_not_configured`）：路由会先确认自己就是当前生效的服务商。这意味着切换之后，旧订阅的续费、取消、退款事件都进不了系统 —— 积分不再按周期发放，订阅状态也不再更新，而且**不会有任何报错**。

同样地，账单页的「管理订阅」是按生效服务商查客户记录的（`billingCustomers.provider`），切换后旧客户记录查不到，接口返回 `no_customer`，用户自助不了。

所以切换的正确姿势是**先把存量订阅处理干净**：让它们自然跑完，或者在旧服务商后台取消并通知用户到新服务商重新订阅，然后才切。历史订单、订阅和积分流水不会被删除或改写（账单表里有 `provider` 列区分），切换不影响已经记好的账。

## 加第四个支付商

路径已经踩平了：新服务商 = 一个 adapter + 一条 webhook 路由 + 几处注册。按现有两个 adapter 的实际改动整理成清单：

1. **实现接口**：新建 `src/core/billing/providers/<name>.ts`，导出 `<NAME>_PROVIDER_ID`，实现 `createCheckout`、`getPortalUrl`、`cancelSubscription`、`verifyWebhook`、`parseEvent`。要调的接口多的话，在它旁边开个子目录放薄 HTTP 客户端（见 `providers/lemonsqueezy/client.ts`，几十行、fetch 可注入）；有官方 SDK 就直接用（见 `providers/stripe.ts`）。
2. **注册**：`src/core/billing/env.ts` 的 `billingProviderNames` 加上名字（`site.config.ts` 的类型和校验都从这里取，加一个枚举值即可）；`providers/index.ts` 的 `createProvider()` 加一个分支，缺 key 时返回 `null`（结账和 webhook 就自动是 503）。
3. **环境变量**：在 `billingServerEnv` 里用 `requiredFor("<name>")` 加这家的密钥变量，写进 `.env.example` 并说明去哪儿拿。
4. **webhook 路由**：新建 `src/app/api/webhooks/<name>/route.ts`，照抄现有路由的十来行 —— 先确认自己是生效服务商（不是就 503），再 `processWebhook(provider, request)`。事件到 `BillingEvent` 的映射表写在 adapter 顶部注释里，那是这个文件最该看懂的地方。
5. **配置**：`site.config.ts` 的 `productIdEnvPrefix` 加一行前缀。如果这家有 test / live 两种模式，看看要不要在 `fakeBillingAllowed` 里加一条硬锁 —— **只在判据可靠时加**：Lemon Squeezy 没有模式变量、密钥也不带标记，就没有加（`src/core/billing/env.ts` 里有完整理由）。
6. **测试**：`providers/<name>.test.ts`。用官方文档的示例 payload 当 fixture（放 `providers/__fixtures__/`），注入假的 SDK / fetch，**不联网、不需要任何真实密钥**；签名用官方 SDK 的离线签名函数或自己算 HMAC。覆盖验签、全部事件映射、结账请求体、门户地址（包括拿不到门户的分支）、取消订阅的幂等，以及「payload 结构不对时返回 null」。
7. **文档**：README 上线清单加一节（产品怎么建、webhook 怎么配、测试卡是什么）；引入新依赖的话，更新 `THIRD-PARTY-NOTICES.md` 并跑 `pnpm notices:check`。
8. **跑一遍**：`pnpm test`（adapter 单测），再把上面那条 e2e 命令的文件名换成 `e2e/billing.spec.ts` 跑一遍 —— 接口鉴权、未签名 webhook、未配置分支这几条，比购买链路快得多。

   ```bash
   # 注意：env 一个字都别省
   EMAIL_TRANSPORT=file E2E_PORT=3100 \
     BILLING_PROVIDER=fake BILLING_SUCCESS_TIMEOUT_MS=8000 \
     CREEM_PRODUCT_ID_PRO=prod_ci_fake_pro CREEM_PRODUCT_ID_LIFETIME=prod_ci_fake_lifetime \
     npx playwright test e2e/billing.spec.ts
   ```

   三个容易踩的坑，症状都不是「命令本身报错」：少了 `E2E_PORT`，`reuseExistingServer` 会复用你正在跑的 `pnpm dev`（默认 3000 端口），测的就不是当前 worktree 的代码（实测：接口全 404）；少了 `EMAIL_TRANSPORT=file`，验证码只打到服务端终端，登录那几条会卡在等邮件；少了 `CREEM_PRODUCT_ID_*`，出厂占位产品 ID 会把结账挡成 503 `plan_not_configured`。

不用为新服务商重测「结账 → webhook → 发积分」的整条链路：adapter 的职责边界就是**把服务商的事件翻译成 `BillingEvent`**，翻译之后的那半条链路和具体服务商无关，已经由 fake 服务商的 e2e 覆盖（`e2e/pricing.spec.ts`）。

## 本地和 CI 用哪个

本地开发、CI 和 e2e 一律用站内的 fake 服务商（`BILLING_PROVIDER=fake`）：结账页和 webhook 都由站内路由模拟，可以设定 webhook 延迟或不发送，不需要任何外部账号。`e2e/billing.spec.ts` 和 `e2e/pricing.spec.ts` 分别覆盖「未配置时的接口行为」和「完整购买链路」。

fake 是测试替身，闸门在 `fakeBillingAllowed`（`src/core/billing/env.ts`）：生产运行时（`next build` / `next start` / Docker）、Vercel 上（任何环境）、`CREEM_MODE=live`、或者配了 live 的 Stripe 密钥，设成 `fake` 都会启动失败；还有一条通用想法 —— 别在任何对外环境里开它，那等于让任何人走假结账白拿套餐和积分。

## 常见问题

**没配密钥会怎样？** 结账和 webhook 接口返回 503 `billing_not_configured`，站点其余部分照常（本地就是这样默认跑起来的）。webhook 路由对**非生效**服务商同样返回 503，所以多挂几条路由不会互相抢事件。

**能同时用两家吗？** 不能。同一时刻只有一家生效，其余服务商的 webhook 会被 503 挡掉。要迁就按上面的「切换前先处理存量订阅」走。

**买家能用什么支付方式？** 由服务商决定，在服务商后台配置，本模板不介入 —— 模板只负责跳转到服务商托管的结账页，不内嵌支付组件。

**想换的支付商没有在这里面？** 按上面的「加第四个支付商」加就行 —— 绝大多数情况只需要新写一个 adapter 文件，其余都不动。
