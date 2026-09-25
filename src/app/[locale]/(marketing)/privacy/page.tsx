import { LegalPage, legalMetadata } from "@/core/legal/legal-page";

import document from "../../../../../content/legal/privacy";

export const metadata = legalMetadata(document);

export default function PrivacyPage() {
  return <LegalPage document={document} />;
}
