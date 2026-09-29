import type { LegalInfo } from "@/core/config/schema";

export type LegalTemplateProps = {
  legal: LegalInfo;
  site: { name: string; domain: string };
  /** mailto link for the contact email, rendered as-is by the templates. */
  email: React.ReactNode;
  /**
   * The payment provider currently in effect (follows `BILLING_PROVIDER`): its name, and whether it
   * is the Merchant of Record. Use it whenever the text mentions who processes payments — never
   * hard-code a specific provider.
   */
  payments: { name: string; merchantOfRecord: boolean };
};

export type LegalDocument = {
  title: string;
  description: string;
  Content: (props: LegalTemplateProps) => React.ReactNode;
};

/** Declares a legal template (content/legal/*.tsx). Only enforces the type. */
export function defineLegalDocument(document: LegalDocument): LegalDocument {
  return document;
}
