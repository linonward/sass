// 模板仅供参考，不构成法律意见。上线前请结合你的业务和适用法律自行审阅，必要时咨询律师。
// 变量来自 site.config.ts 的 `legal`；本文件归业务方所有，可自由修改。
import { Link } from "@/core/i18n/navigation";
import { defineLegalDocument } from "@/core/legal/document";
import { legalPages } from "@/core/legal/pages";

export default defineLegalDocument({
  title: "Terms of Service",
  description: "The terms that govern your use of our service.",
  Content: ({ legal, site, email }) => (
    <>
      <p>
        These Terms of Service (&quot;Terms&quot;) are an agreement between you
        and {legal.companyName} (&quot;we&quot;, &quot;us&quot; or
        &quot;our&quot;) and govern your use of {site.name} at {site.domain}{" "}
        (the &quot;Service&quot;). By creating an account or using the Service,
        you agree to these Terms. If you do not agree, do not use the Service.
      </p>

      <h2>1. Accounts</h2>
      <p>
        You must be at least 16 years old and able to form a binding contract to
        use the Service. You are responsible for your account and for all
        activity under it, and you must keep your sign-in credentials secure. If
        you use the Service on behalf of an organization, you confirm that you
        are authorized to accept these Terms for it.
      </p>

      <h2>2. Purchases and billing</h2>
      <p>
        Our order process is conducted by our online reseller and Merchant of
        Record, Creem, which handles payment processing, invoicing, and sales
        tax or VAT. Creem&apos;s terms and privacy policy also apply to your
        purchase.
      </p>
      <ul>
        <li>
          <strong>Subscriptions</strong> renew automatically at the end of each
          billing period until you cancel. You can cancel at any time, and your
          access continues until the end of the current period.
        </li>
        <li>
          <strong>Price changes</strong> take effect at the start of your next
          billing period, and we will notify you in advance.
        </li>
        <li>
          <strong>Refunds</strong> are handled as described in our{" "}
          <Link href={legalPages.refund}>Refund Policy</Link>.
        </li>
      </ul>

      <h2>3. Credits</h2>
      <p>
        Some features consume credits, which you receive with a plan or buy
        separately. Credits have no cash value, cannot be transferred or
        exchanged for money, and are not redeemable outside the Service. The
        number of credits a feature consumes is shown in the Service and may
        change with notice. Credits included with a subscription may expire at
        the end of each billing period, as described on the pricing page.
      </p>

      <h2>4. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>break any law or infringe anyone&apos;s rights;</li>
        <li>
          upload malware, or attempt to gain unauthorized access to the Service
          or other systems;
        </li>
        <li>
          overload, scrape or reverse engineer the Service, or bypass usage
          limits;
        </li>
        <li>
          use the Service to create or distribute content that is illegal,
          harmful, harassing, deceptive or sexually exploits minors;
        </li>
        <li>resell or share your account without our permission.</li>
      </ul>

      <h2>5. Your content</h2>
      <p>
        You keep all rights to the content you submit. You grant us a limited
        license to host, process and display it only as needed to provide the
        Service to you. You are responsible for having the rights to the content
        you submit.
      </p>

      <h2>6. AI-generated output</h2>
      <p>
        Some features may use artificial intelligence. Output can be inaccurate,
        incomplete or similar to output generated for others. You are
        responsible for reviewing output before relying on it, and it is not
        professional advice.
      </p>

      <h2>7. Our intellectual property</h2>
      <p>
        The Service, including its software, design and trademarks, is owned by
        us or our licensors. We grant you a limited, non-exclusive,
        non-transferable right to use the Service in accordance with these
        Terms.
      </p>

      <h2>8. Suspension and termination</h2>
      <p>
        You may stop using the Service and delete your account at any time. We
        may suspend or terminate your access if you breach these Terms or if
        required by law. Sections that by their nature should survive
        termination will survive.
      </p>

      <h2>9. Disclaimers</h2>
      <p>
        The Service is provided &quot;as is&quot; and &quot;as available&quot;.
        To the fullest extent permitted by law, we disclaim all warranties,
        express or implied, including merchantability, fitness for a particular
        purpose and non-infringement. We do not guarantee that the Service will
        be uninterrupted or error-free.
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, we will not be liable for any
        indirect, incidental, special, consequential or punitive damages, or for
        any loss of profits, data or goodwill. Our total liability for any claim
        relating to the Service is limited to the amount you paid us in the 12
        months before the claim. Nothing in these Terms limits liability that
        cannot be limited under applicable law.
      </p>

      <h2>11. Governing law</h2>
      <p>
        These Terms are governed by the laws of {legal.jurisdiction}, without
        regard to its conflict of law rules. Disputes will be resolved in the
        courts located there, unless the mandatory consumer protection laws of
        your country give you the right to bring a claim where you live.
      </p>

      <h2>12. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. If we make material
        changes, we will notify you by email or through the Service before they
        take effect. Continuing to use the Service after that means you accept
        the updated Terms.
      </p>

      <h2>13. Contact</h2>
      <p>
        Questions about these Terms can be sent to {email}. See also our{" "}
        <Link href={legalPages.privacy}>Privacy Policy</Link>.
      </p>
    </>
  ),
});
