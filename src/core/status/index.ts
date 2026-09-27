import siteConfig from "../../../site.config";

/**
 * `statusPage.enabled`：关闭时 `/status` 和后台状态页都返回 404，菜单里也不出现入口。
 * 和 `features.admin` 一样是构建期常量，所以关掉之后路由不会被打进产物。
 */
export const statusPageEnabled = siteConfig.statusPage.enabled;

export {
  componentLabel,
  getComponentStatus,
  getUptime,
  overallStatus,
} from "./status";
export type { ComponentStatus, OverallStatus, StatusEvent } from "./status";
