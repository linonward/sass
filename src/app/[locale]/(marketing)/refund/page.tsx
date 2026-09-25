import { LegalPage, legalMetadata } from "@/core/legal/legal-page";
import { legalPages } from "@/core/legal/pages";

import document from "../../../../../content/legal/refund";

export const generateMetadata = legalMetadata(document, legalPages.refund);

export default function RefundPage() {
  return <LegalPage document={document} />;
}
