import { headers } from "next/headers";
import { cache } from "react";

import { auth } from "./server";

/** 当前请求的 session；未登录时为 null。同一次渲染内只查询一次。 */
export const getSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);
