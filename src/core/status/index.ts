import siteConfig from "../../../site.config";

/**
 * `statusPage.enabled`: when off, `/status` and the admin status page both return 404 and no menu
 * entry appears. Like `features.admin` it is a build-time constant, so once disabled the routes
 * aren't included in the build output.
 */
export const statusPageEnabled = siteConfig.statusPage.enabled;

export {
  componentLabel,
  getComponentStatus,
  getUptime,
  overallStatus,
} from "./status";
export type { ComponentStatus, OverallStatus, StatusEvent } from "./status";
