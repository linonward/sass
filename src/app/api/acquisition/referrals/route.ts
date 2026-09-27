import { createReferralHandlers } from "@/core/acquisition/referrals/http";
import { createReferralService } from "@/core/acquisition/referrals/service";
import { auth } from "@/core/auth/server";
import { db } from "@/core/db";
import { env } from "@/core/env";
import siteConfig from "../../../../../site.config";

export const { POST } = createReferralHandlers({
  enabled: siteConfig.acquisition.referrals.enabled,
  secret: env.BETTER_AUTH_SECRET,
  getUserId: async (headers) =>
    (await auth.api.getSession({ headers }))?.user.id ?? null,
  service: createReferralService(db),
});
