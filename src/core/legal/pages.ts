// Legal page paths (without the locale prefix). The sitemap, Footer, etc. read them from here.
export const legalPages = {
  privacy: "/privacy",
  terms: "/terms",
  refund: "/refund",
} as const;

export type LegalPageKey = keyof typeof legalPages;
