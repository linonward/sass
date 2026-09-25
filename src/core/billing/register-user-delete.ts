import { registerOnUserDelete } from "@/core/account/on-user-delete";
import { getDb } from "@/core/db";

import { createCancelSubscriptionsHandler } from "./cancel-on-user-delete";
import { getBillingProvider } from "./providers";

registerOnUserDelete(
  "billing:cancel-subscriptions",
  createCancelSubscriptionsHandler({ db: getDb, provider: getBillingProvider }),
);
