import { buildMetadata } from "@/core/seo/metadata";

import siteConfig from "../../../site.config";
import type { LegalDocument } from "./document";

/** 生成法律页的 `generateMetadata`，canonical / hreflang 等由 buildMetadata 统一处理。 */
export function legalMetadata(document: LegalDocument, path: string) {
  return async ({ params }: { params: Promise<{ locale: string }> }) =>
    buildMetadata({
      locale: (await params).locale,
      path,
      title: document.title,
      description: document.description,
    });
}

function formatDate(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

/**
 * 法律页的排版容器。正文只有英文，因此 lang="en"；
 * 在其他语言路径下访问时，外层 Header / Footer 仍按当前语言显示。
 */
export function LegalPage({ document }: { document: LegalDocument }) {
  const { legal, name, domain } = siteConfig;
  const email = (
    <a href={`mailto:${legal.contactEmail}`}>{legal.contactEmail}</a>
  );

  return (
    <article
      lang="en"
      className="text-foreground/90 [&_a]:text-primary-text [&_h2]:font-display [&_h2]:text-foreground [&_h3]:font-display [&_h3]:text-foreground [&_strong]:text-foreground mx-auto max-w-3xl px-4 py-14 text-[0.9375rem] leading-7 sm:py-20 [&_a]:font-medium [&_a]:break-words [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:scroll-mt-20 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:font-semibold [&_li]:mt-1.5 [&_p]:mt-4 [&_strong]:font-semibold [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-6"
    >
      <header className="border-b pb-6">
        <h1 className="heading-display text-foreground text-3xl sm:text-4xl">
          {document.title}
        </h1>
        <p className="text-muted-foreground mt-3! text-sm">
          Effective date:{" "}
          <time dateTime={legal.effectiveDate}>
            {formatDate(legal.effectiveDate)}
          </time>
        </p>
      </header>
      <document.Content legal={legal} site={{ name, domain }} email={email} />
    </article>
  );
}
