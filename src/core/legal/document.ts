import type { LegalInfo } from "@/core/config/schema";

export type LegalTemplateProps = {
  legal: LegalInfo;
  site: { name: string; domain: string };
  /** 联系邮箱的 mailto 链接，模板里直接渲染。 */
  email: React.ReactNode;
};

export type LegalDocument = {
  title: string;
  description: string;
  Content: (props: LegalTemplateProps) => React.ReactNode;
};

/** 声明一份法律模板（content/legal/*.tsx），只做类型约束。 */
export function defineLegalDocument(document: LegalDocument): LegalDocument {
  return document;
}
