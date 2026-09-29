import type messages from "../../../messages/en.json";

// Type-checks against en.json: a wrong key in t("...") fails typecheck.
declare module "next-intl" {
  interface AppConfig {
    Messages: typeof messages;
  }
}
