import { createAttributionHandlers } from "@/core/acquisition/http";
import { createAttributionStore } from "@/core/acquisition/store";
import { auth } from "@/core/auth/server";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { logger } from "@/core/observability/logger";
import siteConfig from "../../../../../site.config";

export const { GET, POST } = createAttributionHandlers({
  enabled: siteConfig.acquisition.attribution.enabled,
  secret: env.BETTER_AUTH_SECRET,
  getUserId: async (headers) =>
    (await auth.api.getSession({ headers }))?.user.id ?? null,
  store: createAttributionStore(db),
  warn: (event) => logger.warn(event),
});
