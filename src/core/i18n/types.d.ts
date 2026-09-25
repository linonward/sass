import type messages from "../../../messages/en.json";

// 以 en.json 为准做类型检查：t("...") 写错 key 会在 typecheck 时报错。
declare module "next-intl" {
  interface AppConfig {
    Messages: typeof messages;
  }
}
