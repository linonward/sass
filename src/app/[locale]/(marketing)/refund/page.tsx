import { LegalPage, legalMetadata } from "@/core/legal/legal-page";

import document from "../../../../../content/legal/refund";

export const metadata = legalMetadata(document);

export default function RefundPage() {
  return <LegalPage document={document} />;
}
