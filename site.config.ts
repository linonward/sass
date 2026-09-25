import { defineConfig } from "./src/core/config/schema";

export default defineConfig({
  name: "Acme",
  domain: "example.com",
  description: "Ship your SaaS in a day.",
  brand: {
    primaryColor: "#4f46e5",
    logo: "/logo.svg",
  },
  locales: ["en"],
  defaultLocale: "en",
  features: {
    credits: false,
    ai: false,
    blog: false,
    upload: false,
    admin: false,
    rateLimit: false,
  },
  nav: {
    header: [
      { key: "features", href: "/#features" },
      { key: "pricing", href: "/#pricing" },
      { key: "faq", href: "/#faq" },
    ],
    footer: [
      {
        key: "product",
        links: [
          { key: "features", href: "/#features" },
          { key: "pricing", href: "/#pricing" },
          { key: "faq", href: "/#faq" },
        ],
      },
    ],
  },
});
