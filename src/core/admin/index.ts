import siteConfig from "../../../site.config";

/** `features.admin` 是否开启。关闭时 /admin 下所有页面返回 404。 */
export const adminEnabled = siteConfig.features.admin;

/** 后台列表每页的条数。 */
export const ADMIN_PAGE_SIZE = 20;

export { ADMIN_ROLE, isAdmin } from "./roles";
