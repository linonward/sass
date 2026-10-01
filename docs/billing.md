# Payment providers

The template ships with **Waffo Pancake** (see the [Waffo Pancake](#waffo-pancake) section below), and also implements **Creem**, **Stripe** and **Lemon Squeezy**. They all implement the same `PaymentProvider` interface (`src/core/billing/provider.ts`) and share the same checkout, webhooks, orders table, credit grants and admin stats — switching providers doesn't touch app code: you change two fields in `site.config.ts` and set a group of environment variables.

This doc covers only **which to pick, how to switch, and how to add another one**. The step-by-step setup for each provider, from zero to real payments, is in the README's [Launch checklist](../README.md#launch-checklist) ([Payments: pick a provider](../README.md#payments-pick-a-provider), then [Waffo Pancake](../README.md#payments-waffo-pancake), [Creem / Stripe](../README.md#payments-creem--stripe) or [Lemon Squeezy](../README.md#payments-lemon-squeezy)); this doc doesn't repeat it.

> External facts such as fees, supported regions and MoR status can change at any time. This doc was checked in **2026-09**; it gives structure, orders of magnitude and the reasoning behind the choice. For exact numbers, the official pages linked in each section are authoritative.

## How to choose

The four differ more in positioning than in fees:

- **Waffo Pancake** (the shipped default): an MoR whose payouts currently go **only to RMB bank cards or Alipay in mainland China**, so it fits individual sellers in mainland China. Fees 3.9% + $0.50, tax collection not switched on yet; details in the [Waffo Pancake](#waffo-pancake) section. If you can't receive RMB payouts, pick one of the three below before launch.
- **Creem**: an MoR. Sellers in mainland China can sign up, payouts include an Alipay option, and review usually takes 1–2 days. Its fees sit in the middle (3.9% + $0.40, higher than Stripe, lower than Lemon Squeezy), and what you pay for is the MoR handling tax, refunds and chargebacks for you — the fastest path to real payments for individuals and small teams.
- **Stripe**: the lowest fees (2.9% + 30¢ in the US) and the most complete toolchain (Billing, Tax, Invoicing, Radar), but **in standard mode it is not an MoR** — you register for, file and pay VAT / sales tax yourself. It suits teams that already have an overseas entity (Hong Kong / Singapore / US, etc.) and want to own their payments stack.
- **Lemon Squeezy**: an MoR with the most payment methods for your customers (including Alipay, WeChat Pay and UnionPay). Its fees are the highest of the four (5% + 50¢). Stripe acquired it in 2024, though, and the official line as of January 2026 is that "the goal is to migrate Lemon Squeezy users to Stripe Managed Payments," while acknowledging slower support responses and product updates. Choosing it today is fine, but plan on "this may be folded into something else within a few years" — fortunately, switching providers only takes two config changes (see below).

| Your situation                                                                             | Choose                                                                                   |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Individual seller in mainland China with an RMB bank card or Alipay                        | Waffo Pancake (the shipped default)                                                      |
| Individual / small team outside mainland China, don't want to deal with tax compliance     | Creem                                                                                    |
| Seller in mainland China who wants payouts outside RMB, or a company account               | Creem (payouts can also go to Alipay)                                                    |
| Already have an overseas entity, want to control your payments stack, want the lowest fees | Stripe                                                                                   |
| Want customers to be able to pay with PayPal / Alipay / WeChat Pay / UnionPay              | Lemon Squeezy (note: subscriptions only support cards, Apple Pay, Google Pay and PayPal) |

## Comparison

The figures below were checked in **2026-09** against each provider's official pages (listed after the table). Fees vary by country, payment method and product type; **the official pages are authoritative before you sign up**.

|                                           | Creem                                                                                   | Stripe                                                                                                                                       | Lemon Squeezy                                                                                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transaction fee                           | 3.9% + $0.40                                                                            | 2.9% + 30¢ (US; Hong Kong 3.4% + HK$2.35, Singapore 3.4% + S$0.50)                                                                           | 5% + 50¢                                                                                                                                                                         |
| Subscription surcharge                    | None                                                                                    | Stripe Billing 0.7% pay-as-you-go, or from $620/month on a monthly plan                                                                      | +0.5% on subscription payments                                                                                                                                                   |
| International cards / currency conversion | No specific currency conversion fee published                                           | International cards +1.5%, currency conversion +1% (US; currency conversion is +2% in Hong Kong and Singapore)                               | International cards +1.5%, PayPal transactions +1.5%                                                                                                                             |
| Payout fee                                | Bank transfer $7 or 1%, whichever is higher; USDC 2%                                    | Depends on country and method                                                                                                                | Free to US banks, 1% outside the US; PayPal payouts 3% outside the US (capped at $30 per payout)                                                                                 |
| Chargeback fee                            | $25 each                                                                                | $15 each (Hong Kong HK$85)                                                                                                                   | $15 each                                                                                                                                                                         |
| Monthly fee                               | None                                                                                    | None (add-ons such as Billing, Tax and custom domains are billed separately)                                                                 | None                                                                                                                                                                             |
| MoR                                       | Yes                                                                                     | Standard mode is **not**; Managed Payments is (+3.5% on top of standard fees)                                                                | Yes                                                                                                                                                                              |
| Seller regions                            | 87 countries / regions, **including mainland China, Hong Kong and Singapore**           | Supported list includes Hong Kong and Singapore, **not mainland China**; in Asia-Pacific, Managed Payments is only open to AU / HK / JP / SG | Bank payouts in about 120 countries including Hong Kong, Singapore, Macau and Taiwan; **mainland China is not on the bank payout list**; PayPal payouts in 200+                  |
| Customer payment methods                  | Cards, Apple Pay, Google Pay                                                            | Depends on your Stripe configuration                                                                                                         | Cards (including UnionPay), PayPal, Apple Pay, Google Pay, Alipay, WeChat Pay, Cash App Pay, bank debits; **subscriptions only support cards, Apple Pay, Google Pay and PayPal** |
| Go-live approval                          | Manual KYC / KYB review in 24–48 hours (72 hours at peak); rejections can't be appealed | No manual review in standard mode                                                                                                            | Activation questionnaire + identity verification, about 2–3 business days                                                                                                        |

Sources: [creem.io/pricing](https://www.creem.io/pricing), [docs.creem.io finance docs](https://docs.creem.io/merchant-of-record/finance/payouts.md), [Creem supported countries](https://docs.creem.io/merchant-of-record/supported-countries); [stripe.com/pricing](https://stripe.com/pricing), [stripe.com/global](https://stripe.com/global), [Managed Payments eligibility](https://docs.stripe.com/payments/managed-payments/eligibility), [Stripe Billing pricing](https://stripe.com/billing/pricing); [lemonsqueezy.com/pricing](https://www.lemonsqueezy.com/pricing), [LS fees](https://docs.lemonsqueezy.com/help/getting-started/fees), [LS supported countries](https://docs.lemonsqueezy.com/help/getting-started/supported-countries), [LS getting paid](https://docs.lemonsqueezy.com/help/getting-started/getting-paid).

Three facts that don't fit in the table but affect the decision:

- **Stripe's fees depend on the seller's country**; the table uses the US. In Hong Kong and Singapore card fees are 3.4% plus a small amount in local currency. Cross-border and currency conversion surcharges also vary by region.
- **Stripe doesn't publish the full list of merchant countries for Managed Payments**: the eligibility page lists AU / HK / JP / SG in Asia-Pacific, CA / US in North America, plus a set of European countries (LS's official blog says "35+ countries") — **a mainland China entity can't use it**. More importantly, its **restricted customer regions include mainland China**: your mainland customers can't buy under Managed Payments.
- **Lemon Squeezy's subscription interval is capped at 1 year**, and subscriptions can only be paid with cards, Apple Pay, Google Pay or PayPal (Alipay / WeChat Pay and the like only support one-time payments).

## What an MoR is

A Merchant of Record (MoR) is the **seller in the legal sense**: the customer pays the MoR, and the MoR then settles with you. It takes on:

- **Global tax**: calculating, collecting, filing and paying VAT / GST / sales tax based on where the customer is (Creem says it covers 190+ countries; Stripe Managed Payments says 80+).
- **Refunds and chargebacks**: handled by the MoR, and chargeback liability is also its own — in Lemon Squeezy's docs: "Generally, Lemon Squeezy is responsible for handling any chargebacks made against your sales".
- Compliant invoices and PCI compliance.

Conversely, **a non-MoR (standard Stripe) means all of this is your responsibility**: registering for a tax ID in every jurisdiction where you have customers, filing and paying. Stripe Tax only calculates and collects tax (Basic is 0.5% per transaction or 50¢ per transaction) and **doesn't file**; to have registration and filing done for you, you need Tax Complete, starting at $90/month. The two or three points you save with standard Stripe largely come from "you do this work yourself."

You don't have to guess; the basis is the providers' own wording: Creem and Lemon Squeezy both explicitly call themselves the merchant of record in their docs; section 7.3(b) of Stripe's SSA says the user is responsible for "assessing, collecting, reporting, and remitting Taxes", and its comparison doc lists the "Merchant of record" row as **Managed Payments → Stripe; other Stripe products → Your business**.

(Lemon Squeezy's terms use the wording "non-exclusive reseller", which has the same legal meaning.)

For a SaaS selling internationally, the main benefit of an MoR is **saving the people-hours of tax compliance**: you don't need to register for a tax ID in every country where you have customers or track filing deadlines. The cost is fees 1–3 percentage points higher, and an extra layer between you and your customers.

## How they actually differ in the product

The thing most easily overlooked when choosing is that "under the same interface, the providers don't behave exactly the same." All of the differences below come from this template's implementation and directly determine what you have to do operationally:

|                                             | Creem                                                            | Stripe                                                                                                            | Lemon Squeezy                                                                                                                             | Waffo Pancake                                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| What the product ID means                   | Product ID (`prod_`)                                             | Price ID (`price_`)                                                                                               | Variant ID (variant)                                                                                                                      | Product ID (`PROD_`)                                                                                             |
| Variable prefix                             | `CREEM_PRODUCT_ID_*`                                             | `STRIPE_PRICE_ID_*`                                                                                               | `LEMONSQUEEZY_VARIANT_ID_*`                                                                                                               | `WAFFO_PRODUCT_ID_*`                                                                                             |
| Checkout cancel URL                         | Not supported; the user just closes the page                     | Supports `cancel_url`                                                                                             | Not supported; the user just closes the page                                                                                              | Not supported; the user just closes the page                                                                     |
| Customer portal                             | `customers.generateBillingLinks`                                 | Billing Portal session, requires `return_url`; the portal configuration must be saved once in the dashboard first | Reads the customer's `customer_portal` URL, **which only has a value while the customer has an active subscription**; otherwise it errors | Hosted magic-link sign-in page shared across merchants (no pre-authenticated link)                               |
| Canceling subscriptions on account deletion | Cancels immediately                                              | Cancels immediately                                                                                               | Only stops future charges; the user keeps access until `ends_at`                                                                          | Stops future charges; the user keeps access until the end of the current period                                  |
| Reclaiming credits on refund                | Reclaims in proportion to the amount refunded (`refund.created`) | **Doesn't reclaim**: the refund object has no invoice field, so v1 ignores refund events                          | **Only reclaims on full refunds**; partial refunds don't reclaim                                                                          | Reclaims in proportion to the refunded payment, partial or full (refunds are possible within 14 days of payment) |
| Test / live                                 | `CREEM_MODE=test` / `live`, two domains                          | The key itself tells them apart (`sk_test_` / `sk_live_`)                                                         | A toggle on the store; keys don't differ                                                                                                  | `WAFFO_MODE=test` / `prod`; private keys and product IDs are separate per environment                            |
| Fake hard lock                              | Refused when `CREEM_MODE=live`                                   | Refused when an `sk_live_` / `rk_live_` key is set                                                                | None: there's no reliable signal to check; see the comment in `src/core/billing/env.ts`                                                   | Refused when `WAFFO_MODE=prod`                                                                                   |

## Waffo Pancake

The shipped default, integrated by following the "Adding another provider" path (`src/core/billing/providers/waffo.ts`, official SDK `@waffo/pancake-ts`). It's an MoR (Waffo.com Limited, Hong Kong), has a product catalog, and integrates most like Creem / Lemon Squeezy. Things to know before choosing it (checked in **2026-09**, source: [docs.waffo.ai](https://docs.waffo.ai)):

- **Payouts are currently RMB only**: to a mainland China bank card or Alipay (Alipay is capped at 50,000 per payout and 300,000 per year), with identity verification by mainland ID card or passport; payouts to company accounts are "coming soon." In practice it's for **individual sellers in mainland China** — sellers without a mainland bank card / Alipay can't get paid.
- **An MoR, but tax collection isn't switched on yet**: the official webhook docs state that the tax rate on every order is currently 0. It takes on the seller-of-record role and chargebacks; for tax, check again as it progresses.
- **Fees**: cards and wallets 3.9% + $0.50, no monthly fee; refunds $1 each (the original fee isn't returned); payouts 1% (minimum $10); chargebacks $25.
- **Customer side**: cards, Apple Pay, Google Pay; currencies USD / EUR / GBP / JPY / HKD (CNY only for one-time products).
- **In-product differences**: the customer portal is a hosted magic-link sign-in page (no pre-authenticated link); canceling a subscription keeps it until the end of the current period; refunds reclaim credits against the specific payment refunded (partial or full, within 14 days of payment); the fake hard lock is `WAFFO_MODE=prod`; webhooks are always verified for the current environment, and events from the other environment are rejected.
- **Before going live** the store must pass review (1–3 business days).

For step-by-step go-live setup, see [Payments (Waffo Pancake)](../README.md#payments-waffo-pancake) in the README.

The refund row is **a real-money difference**, and it's worth reading the README's [Revenue definition](../README.md#revenue-definition) and the launch checklist section for your provider on their own: Creem automatically reclaims credits in proportion; Stripe doesn't handle it at all (refunds are done only in the dashboard, and credits have to be handled manually); Lemon Squeezy only recognizes full refunds; Waffo Pancake reclaims in proportion to the specific payment refunded, partial or full, and refunds are only possible within 14 days of payment.

## Switching providers

Prerequisite: the account and products at the target provider are already set up (steps in the corresponding section of the README launch checklist, including the webhook URL, event list and test cards).

1. **Change `site.config.ts`**: change the `billingProvider` literal to the target provider, and replace the `providerProductId` of both paid plans with the object IDs on the new provider's side (Creem product, Stripe Price, Lemon Squeezy variant, Waffo Pancake product).

   ```ts
   const billingProvider: BillingProviderName = "stripe";
   ```

   `billingProvider` can also be overridden at runtime by `BILLING_PROVIDER`; changing both is the least likely to be forgotten. The environment variable prefix for product IDs follows the provider **in effect**, so with Stripe selected, `WAFFO_PRODUCT_ID_*` is ignored.

2. **Set environment variables**. After switching you need a whole new set of variables (`.env.example` is authoritative for variable names):

   ```bash
   # Stripe: provider in effect + keys + product IDs
   BILLING_PROVIDER=stripe
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   STRIPE_PRICE_ID_PRO=price_...
   STRIPE_PRICE_ID_LIFETIME=price_...
   ```

   ```bash
   # Lemon Squeezy: one extra STORE_ID (creating a checkout session must include the store relationship)
   BILLING_PROVIDER=lemonsqueezy
   LEMONSQUEEZY_API_KEY=...
   LEMONSQUEEZY_WEBHOOK_SECRET=...
   LEMONSQUEEZY_STORE_ID=...
   LEMONSQUEEZY_VARIANT_ID_PRO=...
   LEMONSQUEEZY_VARIANT_ID_LIFETIME=...
   ```

   ```bash
   # Creem: remember CREEM_MODE must be set to live before real payments
   BILLING_PROVIDER=creem
   CREEM_API_KEY=...
   CREEM_WEBHOOK_SECRET=...
   CREEM_PRODUCT_ID_PRO=prod_...
   CREEM_PRODUCT_ID_LIFETIME=prod_...
   CREEM_MODE=test
   ```

   ```bash
   # Waffo Pancake (the shipped default): merchant ID + API private key; set WAFFO_MODE=prod for real payments. Private keys and
   # product IDs belong to one environment (test or prod) and don't carry over
   BILLING_PROVIDER=waffo
   WAFFO_MERCHANT_ID=MER_...
   WAFFO_PRIVATE_KEY=...
   WAFFO_PRODUCT_ID_PRO=PROD_...
   WAFFO_PRODUCT_ID_LIFETIME=PROD_...
   WAFFO_MODE=test
   ```

   Fill in only the set for the provider **in effect**: if Vercel production is missing the keys for the provider in effect, the build fails outright (`billingServerEnv` in `src/core/billing/env.ts` only makes them required when "Vercel production + the site has paid plans + this is the provider in effect"). Locally it doesn't; a missing key means checkout and webhooks return 503, and everything else works as usual.

3. **Add a webhook endpoint in the new provider's dashboard**, pointing to `https://<your-domain>/api/webhooks/<provider>`. Which events to select, where to get the signing secret and how to forward locally are all written up in the corresponding section of the README launch checklist — missing an event doesn't produce an error, it just silently drops transactions.

4. **Verify**: unit tests + the full in-product purchase flow.

   ```bash
   pnpm test   # adapter unit tests, using the official sample payloads as fixtures; no network, no real keys needed
   ```

   ```bash
   # The full flow (checkout → webhook → credit grant) runs against the built-in fake provider and is independent of any specific provider:
   EMAIL_TRANSPORT=file E2E_PORT=3100 \
     BILLING_PROVIDER=fake BILLING_SUCCESS_TIMEOUT_MS=8000 \
     WAFFO_PRODUCT_ID_PRO=prod_ci_fake_pro WAFFO_PRODUCT_ID_LIFETIME=prod_ci_fake_lifetime \
     npx playwright test e2e/pricing.spec.ts
   ```

   `E2E_PORT` switches to another port so it doesn't reuse the `pnpm dev` you have running. You need to place a test-mode order with the real provider yourself in the new provider's dashboard (the README launch checklist has test card numbers); this template doesn't automate that.

### Handle existing subscriptions before switching

Only one provider is in effect at a time, and **the old provider's webhook route always returns 503 after the switch** (`billing_not_configured`): the route first checks that it is the provider currently in effect. This means that after switching, renewal, cancellation and refund events for old subscriptions never reach the system — credits stop being granted each period, subscription status stops updating, and **there's no error of any kind**.

Likewise, "Manage subscription" on the billing page looks up the customer record by the provider in effect (`billingCustomers.provider`). After switching, old customer records aren't found, the endpoint returns `no_customer`, and users can't help themselves.

So the right way to switch is to **clear out existing subscriptions first**: let them run out naturally, or cancel them in the old provider's dashboard and tell users to resubscribe with the new provider, and only then switch. Historical orders, subscriptions and credit transactions aren't deleted or rewritten (the billing tables have a `provider` column to tell them apart), so switching doesn't affect what's already recorded.

## Adding another provider

The path is already well worn: a new provider = one adapter + one webhook route + a few registrations. Here's the checklist, based on the changes the existing adapters actually needed:

1. **Implement the interface**: create `src/core/billing/providers/<name>.ts`, export `<NAME>_PROVIDER_ID`, and implement `createCheckout`, `getPortalUrl`, `cancelSubscription`, `verifyWebhook` and `parseEvent`. If there are many endpoints to call, add a subdirectory next to it for a thin HTTP client (see `providers/lemonsqueezy/client.ts`, a few dozen lines with injectable fetch); if there's an official SDK, just use it (see `providers/stripe.ts`).
2. **Register it**: add the name to `billingProviderNames` in `src/core/billing/env.ts` (the types and validation in `site.config.ts` both come from here, so adding one enum value is enough); add a branch to `createProvider()` in `providers/index.ts` that returns `null` when keys are missing (checkout and webhooks then automatically return 503).
3. **Environment variables**: add this provider's key variables to `billingServerEnv` with `requiredFor("<name>")`, and write them into `.env.example` with a note on where to get them.
4. **Webhook route**: create `src/app/api/webhooks/<name>/route.ts` by copying the ten-or-so lines of an existing route — first check that it's the provider in effect (503 if not), then `processWebhook(provider, request)`. The mapping from events to `BillingEvent` goes in the comment at the top of the adapter; that's the part of the file most worth understanding.
5. **Configuration**: add a prefix line to `productIdEnvPrefix` in `site.config.ts`. If the provider has test / live modes, consider adding a hard lock in `fakeBillingAllowed` — **only when there's a reliable signal**: Lemon Squeezy has no mode variable and its keys carry no marker, so none was added (the full reasoning is in `src/core/billing/env.ts`).
6. **Tests**: `providers/<name>.test.ts`. Use sample payloads from the official docs as fixtures (in `providers/__fixtures__/`), inject a fake SDK / fetch, **no network and no real keys at all**; for signatures, use the official SDK's offline signing function or compute the HMAC yourself. Cover signature verification, every event mapping, the checkout request body, the portal URL (including the branch where there's no portal), idempotent subscription cancellation, and "returns null when the payload structure is wrong."
7. **Docs**: add a section to the README launch checklist (how to create products, how to configure the webhook, what the test cards are); if you add a new dependency, update `THIRD-PARTY-NOTICES.md` and run `pnpm notices:check`.
8. **Run it**: `pnpm test` (adapter unit tests), then run the e2e command above with the file name changed to `e2e/billing.spec.ts` — endpoint auth, unsigned webhooks and the unconfigured branch are much faster than the purchase flow.

   ```bash
   # Note: don't leave out a single env var
   EMAIL_TRANSPORT=file E2E_PORT=3100 \
     BILLING_PROVIDER=fake BILLING_SUCCESS_TIMEOUT_MS=8000 \
     WAFFO_PRODUCT_ID_PRO=prod_ci_fake_pro WAFFO_PRODUCT_ID_LIFETIME=prod_ci_fake_lifetime \
     npx playwright test e2e/billing.spec.ts
   ```

   Three easy traps, none of which show up as "the command itself errors": without `E2E_PORT`, `reuseExistingServer` reuses the `pnpm dev` you have running (port 3000 by default), so you aren't testing the current worktree's code (observed: every endpoint returns 404); without `EMAIL_TRANSPORT=file`, verification codes only print to the server terminal, and the sign-in tests hang waiting for email; without `CREEM_PRODUCT_ID_*`, the shipped placeholder product IDs block checkout with 503 `plan_not_configured`.

You don't need to retest the whole "checkout → webhook → credit grant" flow for a new provider: the adapter's job ends at **translating the provider's events into `BillingEvent`**, and the half of the flow after translation is independent of any specific provider and already covered by the fake provider's e2e (`e2e/pricing.spec.ts`).

## Which provider to use locally and in CI

Local development, CI and e2e all use the built-in fake provider (`BILLING_PROVIDER=fake`): the checkout page and webhooks are simulated by in-app routes, you can set a webhook delay or not send it at all, and no external accounts are needed. `e2e/billing.spec.ts` and `e2e/pricing.spec.ts` cover "endpoint behavior when unconfigured" and "the full purchase flow" respectively.

Fake is a test double, gated by `fakeBillingAllowed` (`src/core/billing/env.ts`). Setting `fake` fails at startup on Vercel (any environment), with `CREEM_MODE=live`, with `WAFFO_MODE=prod`, or with a live Stripe key configured — nothing overrides these. It also fails in a production runtime (`next build` / `next start` / Docker) unless `ALLOW_FAKE_BILLING=1` (or `true`) is set; that is how CI runs e2e against a production build. There's also a general rule: don't turn it on in any public-facing environment — that would let anyone go through fake checkout and get plans and credits for free.

## FAQ

**What happens without keys?** The checkout and webhook endpoints return 503 `billing_not_configured`, and the rest of the site works as usual (this is how it runs locally by default). Webhook routes for providers **not in effect** also return 503, so mounting several routes doesn't make them compete for events.

**Can I use two providers at once?** No. Only one provider is in effect at a time; webhooks for the others are blocked with 503. To migrate, follow "Handle existing subscriptions before switching" above.

**What payment methods can customers use?** That's up to the provider and configured in the provider's dashboard; this template doesn't get involved — it only redirects to the provider's hosted checkout page and doesn't embed payment components.

**The provider I want isn't one of these?** Add it following "Adding another provider" above — in the vast majority of cases you only write one new adapter file and leave everything else alone.
