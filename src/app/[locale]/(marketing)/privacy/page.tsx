import { LegalPage, legalMetadata } from "@/core/legal/legal-page";
import { legalPages } from "@/core/legal/pages";

import document from "../../../../../content/legal/privacy";

export const generateMetadata = legalMetadata(document, legalPages.privacy);

export default function PrivacyPage() {
  return <LegalPage document={document} />;
}
