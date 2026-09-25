// 模板仅供参考，不构成法律意见。上线前请结合你的业务和适用法律自行审阅，必要时咨询律师。
// 变量来自 site.config.ts 的 `legal`；本文件归业务方所有，可自由修改。
// 退款期限、积分是否可退等规则按你的实际政策调整，并与支付平台的设置保持一致。
import { Link } from "@/core/i18n/navigation";
import { defineLegalDocument } from "@/core/legal/document";
import { legalPages } from "@/core/legal/pages";

export default defineLegalDocument({
  title: "Refund Policy",
  description:
    "When and how you can get a refund for subscriptions and credits.",
  Content: ({ legal, site, email }) => (
    <>
      <p>
        This Refund Policy explains when you can get a refund for purchases from{" "}
        {legal.companyName} on {site.name}. Purchases are processed by Creem,
        our reseller and Merchant of Record, which issues approved refunds on
        our behalf.
      </p>

      <h2>1. Subscriptions</h2>
      <ul>
        <li>
          You can cancel your subscription at any time from your account. After
          you cancel, it will not renew, and you keep access until the end of
          the current billing period.
        </li>
        <li>
          If you are not satisfied with your first subscription payment, you can
          request a full refund within <strong>14 days</strong> of the purchase.
        </li>
        <li>
          Renewal payments are generally not refundable. If you forgot to cancel
          and have not used the Service since the renewal, contact us within 7
          days and we will review your request.
        </li>
      </ul>

      <h2>2. Credit packs</h2>
      <ul>
        <li>
          Unused credit packs can be refunded within <strong>14 days</strong> of
          purchase.
        </li>
        <li>
          If you have used part of a credit pack, we may refund the unused
          portion at our discretion. Credits that have been used are not
          refundable.
        </li>
        <li>
          Credits included with a subscription cannot be refunded separately.
        </li>
      </ul>

      <h2>3. Service problems</h2>
      <p>
        If a feature fails because of an error on our side, the credits used for
        that request are returned to your balance automatically. If that did not
        happen, or if a technical problem prevented you from using the Service,
        contact us and we will make it right.
      </p>

      <h2>4. How to request a refund</h2>
      <p>
        Email {email} from the address on your account, and include your order
        number and the reason for your request. We aim to respond within 3
        business days. Approved refunds go back to your original payment method,
        and usually appear within 5–10 business days, depending on your bank.
      </p>

      <h2>5. Chargebacks</h2>
      <p>
        Please contact us before disputing a charge with your bank, as we can
        usually resolve problems faster. We may suspend accounts with an open
        chargeback while it is being resolved.
      </p>

      <h2>6. Your statutory rights</h2>
      <p>
        This policy does not affect any rights you have under the consumer
        protection laws of your country. If you are a consumer in the EU or UK,
        you agree that digital services start immediately after purchase, and
        you acknowledge that you lose the right of withdrawal for the portion of
        the Service you have already used.
      </p>

      <p>
        See also our <Link href={legalPages.terms}>Terms of Service</Link>.
      </p>
    </>
  ),
});
