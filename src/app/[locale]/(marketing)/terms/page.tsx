import { LegalPage, legalMetadata } from "@/core/legal/legal-page";

import document from "../../../../../content/legal/terms";

export const metadata = legalMetadata(document);

export default function TermsPage() {
  return <LegalPage document={document} />;
}
