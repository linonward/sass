// 法律页的路径（不含语言前缀）。sitemap、Footer 等处从这里取。
export const legalPages = {
  privacy: "/privacy",
  terms: "/terms",
  refund: "/refund",
} as const;

export type LegalPageKey = keyof typeof legalPages;
