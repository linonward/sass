// 模板仅供参考，不构成法律意见。上线前请结合你的业务和适用法律自行审阅，必要时咨询律师。
// 变量来自 site.config.ts 的 `legal`；本文件归业务方所有，可自由修改。
import { Link } from "@/core/i18n/navigation";
import { defineLegalDocument } from "@/core/legal/document";
import { legalPages } from "@/core/legal/pages";

export default defineLegalDocument({
  title: "Privacy Policy",
  description:
    "How we collect, use, share and protect your personal information.",
  Content: ({ legal, site, email }) => (
    <>
      <p>
        This Privacy Policy explains how {legal.companyName} (&quot;we&quot;,
        &quot;us&quot; or &quot;our&quot;) collects, uses and shares information
        about you when you use {site.name} at {site.domain} (the
        &quot;Service&quot;). By using the Service, you agree to the practices
        described here.
      </p>

      <h2>1. Information we collect</h2>
      <h3>Information you provide</h3>
      <ul>
        <li>
          <strong>Account information:</strong> your email address, and your
          name and profile picture if you sign in with Google.
        </li>
        <li>
          <strong>Content:</strong> any text, files or other material you submit
          to the Service, and the results generated for you.
        </li>
        <li>
          <strong>Communications:</strong> messages you send us, for example
          support requests.
        </li>
      </ul>
      <h3>Information collected automatically</h3>
      <ul>
        <li>
          <strong>Usage and device data:</strong> IP address, browser type,
          pages visited, and timestamps, collected through server logs.
        </li>
        <li>
          <strong>Cookies and local storage:</strong> we use strictly necessary
          cookies to keep you signed in and to remember your language, and local
          storage to remember your theme preference.
        </li>
      </ul>
      <h3>Payment information</h3>
      <p>
        Payments are processed by our reseller and Merchant of Record, Creem. We
        do not receive or store your full card details. We receive limited
        information from Creem, such as your order status, plan and billing
        country.
      </p>

      <h2>2. How we use information</h2>
      <ul>
        <li>To provide, maintain and improve the Service;</li>
        <li>
          To create and secure your account, including sending sign-in codes;
        </li>
        <li>To process purchases, subscriptions and credit balances;</li>
        <li>
          To send transactional emails, such as receipts and account notices;
        </li>
        <li>To prevent fraud and abuse, and to enforce our terms;</li>
        <li>To comply with legal obligations.</li>
      </ul>
      <p>
        Where the GDPR or similar laws apply, we rely on the following legal
        bases: performance of a contract, our legitimate interests in running
        and securing the Service, compliance with legal obligations, and your
        consent where required.
      </p>

      <h2>3. How we share information</h2>
      <p>
        We do not sell your personal information. We share it only with service
        providers who help us operate the Service, under contracts that limit
        their use of it:
      </p>
      <ul>
        <li>
          <strong>Creem</strong> — payment processing and tax compliance as our
          Merchant of Record;
        </li>
        <li>
          <strong>Google</strong> — sign-in, if you choose to sign in with
          Google;
        </li>
        <li>
          <strong>Resend</strong> — delivery of sign-in codes and transactional
          emails;
        </li>
        <li>
          <strong>Hosting and infrastructure providers</strong> — application
          hosting, databases, file storage and, where applicable, AI model
          providers that process the content you submit.
        </li>
      </ul>
      <p>
        We may also disclose information if required by law, to protect our
        rights or the safety of others, or as part of a merger, acquisition or
        sale of assets.
      </p>

      <h2>4. International transfers</h2>
      <p>
        Our service providers may process information in countries other than
        your own, including the United States. Where required, we rely on
        appropriate safeguards such as Standard Contractual Clauses.
      </p>

      <h2>5. Data retention</h2>
      <p>
        We keep your information for as long as your account is active and as
        needed to provide the Service. After you delete your account, we delete
        or anonymize your personal information within a reasonable period,
        except where we must keep it for legal, tax or accounting purposes.
      </p>

      <h2>6. Your rights</h2>
      <p>
        Depending on where you live, you may have the right to access, correct,
        delete or export your personal information, to object to or restrict
        certain processing, and to withdraw consent. To exercise these rights,
        contact us at {email}. You may also lodge a complaint with your local
        data protection authority.
      </p>

      <h2>7. Security</h2>
      <p>
        We use reasonable technical and organizational measures to protect your
        information, including encryption in transit. No method of transmission
        or storage is completely secure.
      </p>

      <h2>8. Children</h2>
      <p>
        The Service is not directed to children under 16, and we do not
        knowingly collect personal information from them.
      </p>

      <h2>9. Changes to this policy</h2>
      <p>
        We may update this policy from time to time. If we make material
        changes, we will notify you by email or through the Service before they
        take effect. The effective date above shows when it was last updated.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions about this policy can be sent to {email}. See also our{" "}
        <Link href={legalPages.terms}>Terms of Service</Link>.
      </p>
    </>
  ),
});
