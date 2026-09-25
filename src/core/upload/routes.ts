import { auth } from "@/core/auth/server";
import { getDb } from "@/core/db";
import { checkRateLimit } from "@/core/ratelimit";

import type { UploadRouteContext } from "./handlers";
import { uploadDeps, uploadEnabled } from "./index";

/** 绑定登录、限流、数据库和 R2 的路由依赖，供 src/app/api/upload/* 使用。 */
export const uploadRouteContext: UploadRouteContext = {
  enabled: uploadEnabled,
  getUserId: async (request) => {
    const session = await auth.api.getSession({ headers: request.headers });
    return session?.user.id ?? null;
  },
  checkRateLimit,
  deps: () => uploadDeps(getDb()),
};
