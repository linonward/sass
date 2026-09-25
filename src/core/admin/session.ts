import { notFound } from "next/navigation";
import { cache } from "react";

import { getSession } from "@/core/auth/session";

import { adminEnabled } from "./index";
import { isAdmin } from "./roles";

/** 当前请求的管理员 session；未登录、不是 admin 或 features.admin 关闭时为 null。 */
export const getAdminSession = cache(async () => {
  if (!adminEnabled) return null;
  const session = await getSession();
  return session && isAdmin(session.user) ? session : null;
});

/**
 * 后台页面开头调用：不是管理员时返回 404（不暴露后台的存在，也不跳转登录页）。
 * layout 和 page 是并行渲染的，layout 里的检查挡不住 page，所以每个页面都要调用。
 */
export async function requireAdmin() {
  return (await getAdminSession()) ?? notFound();
}
