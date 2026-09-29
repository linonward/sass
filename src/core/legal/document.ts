import type { LegalInfo } from "@/core/config/schema";

export type LegalTemplateProps = {
  legal: LegalInfo;
  site: { name: string; domain: string };
  /** 联系邮箱的 mailto 链接，模板里直接渲染。 */
  email: React.ReactNode;
  /**
   * 当前生效的支付服务商（随 `BILLING_PROVIDER` 变）：名称，以及它是不是 Merchant of Record。
   * 正文里提到付款处理方时用它，不要写死某一家。
   */
  payments: { name: string; merchantOfRecord: boolean };
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
