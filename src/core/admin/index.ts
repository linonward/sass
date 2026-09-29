import siteConfig from "../../../site.config";

/** Whether `features.admin` is on. When off, every page under /admin returns 404. */
export const adminEnabled = siteConfig.features.admin;

/** Rows per page in admin lists. */
export const ADMIN_PAGE_SIZE = 20;

export { ADMIN_ROLE, isAdmin } from "./roles";
