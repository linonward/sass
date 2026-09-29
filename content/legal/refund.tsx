// This template is for reference only and is not legal advice. Before launch, review it against
// your business and the applicable law, and consult a lawyer if needed.
// Variables come from `legal` in site.config.ts; this file belongs to your app, so edit it freely.
// The default policy is "no refunds on digital products once sold" (except duplicate charges /
// unauthorized payments). If you sell physical goods or want a refund window, rewrite it to match
// your actual policy and keep it consistent with your payment platform's settings. In some regions
// a no-refund policy requires customers to explicitly waive their right of withdrawal at purchase.
import { Link } from "@/core/i18n/navigation";
import { defineLegalDocument } from "@/core/legal/document";
import { legalPages } from "@/core/legal/pages";

export default defineLegalDocument({
  title: "Refund Policy",
  description:
    "Purchases of digital products, subscriptions and credits are final.",
  Content: ({ legal, site, email, payments }) => (
    <>
      <p>
        This Refund Policy applies to purchases from {legal.companyName} on{" "}
        {site.name}. Purchases are processed by{" "}
        {payments.merchantOfRecord
          ? `${payments.name}, our reseller and Merchant of Record`
          : `our payment processor, ${payments.name}`}
        .
      </p>

      <h2>1. All sales are final</h2>
      <p>
        {site.name} sells digital products and services that are delivered
        immediately after purchase, such as downloadable software, access to the
        Service, and credits. Once a purchase has been delivered, it is{" "}
        <strong>final and non-refundable</strong>.
      </p>
      <ul>
        <li>
          <strong>Subscriptions</strong>: you can cancel at any time from your
          account. After you cancel, your subscription will not renew, and you
          keep access until the end of the current billing period. We do not
          refund the current or past billing periods.
        </li>
        <li>
          <strong>One-time purchases and credits</strong> are not refundable,
          whether or not they have been used.
        </li>
      </ul>

      <h2>2. Duplicate or unauthorized charges</h2>
      <p>
        If you were charged more than once for the same order, or you did not
        authorize a payment, contact us at {email} within 14 days of the charge
        with your order number. We will investigate and refund charges made in
        error.
      </p>

      <h2>3. Service problems</h2>
      <p>
        If a feature fails because of an error on our side, the credits used for
        that request are returned to your balance automatically. If that did not
        happen, or if a technical problem prevented you from using the Service,
        contact us at {email} and we will make it right.
      </p>

      <h2>4. Chargebacks</h2>
      <p>
        Please contact us before disputing a charge with your bank, as we can
        usually resolve problems faster. We may suspend accounts with an open
        chargeback while it is being resolved.
      </p>

      <h2>5. Your statutory rights</h2>
      <p>
        This policy does not affect any rights you have under the consumer
        protection laws of your country. If you are a consumer in the EU or UK,
        by completing your purchase you request immediate delivery of digital
        content and acknowledge that you lose your right of withdrawal once
        delivery has begun.
      </p>

      <p>
        See also our <Link href={legalPages.terms}>Terms of Service</Link>.
      </p>
    </>
  ),
});
