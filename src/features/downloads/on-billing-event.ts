// Imported from src/core/billing/hooks.ts so it's registered before any billing event is handled.
import { registerOnBillingEvent } from "@/core/billing/on-billing-event";

import siteConfig from "../../../site.config";
import { createDownloadsHandler } from "./grant";

registerOnBillingEvent(
  "downloads:grant",
  createDownloadsHandler({ config: siteConfig.downloads }),
);
