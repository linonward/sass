// 在 src/core/billing/hooks.ts 里 import，处理账单事件前注册好。
import { registerOnBillingEvent } from "@/core/billing/on-billing-event";

import siteConfig from "../../../site.config";
import { createDownloadsHandler } from "./grant";

registerOnBillingEvent(
  "downloads:grant",
  createDownloadsHandler({ config: siteConfig.downloads }),
);
