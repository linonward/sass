import { LegalPage, legalMetadata } from "@/core/legal/legal-page";
import { legalPages } from "@/core/legal/pages";

import document from "../../../../../content/legal/terms";

export const generateMetadata = legalMetadata(document, legalPages.terms);

export default function TermsPage() {
  return <LegalPage document={document} />;
}
