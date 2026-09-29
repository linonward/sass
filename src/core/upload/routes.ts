import { auth } from "@/core/auth/server";
import { getDb } from "@/core/db";
import { checkRateLimit } from "@/core/ratelimit";

import type { UploadRouteContext } from "./handlers";
import { uploadDeps, uploadEnabled } from "./index";

/** Route dependencies bound to auth, rate limiting, the database and R2, used by src/app/api/upload/*. */
export const uploadRouteContext: UploadRouteContext = {
  enabled: uploadEnabled,
  getUserId: async (request) => {
    const session = await auth.api.getSession({ headers: request.headers });
    return session?.user.id ?? null;
  },
  checkRateLimit,
  deps: () => uploadDeps(getDb()),
};
