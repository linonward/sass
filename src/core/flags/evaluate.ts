import { createHash } from "node:crypto";

import type { SiteConfig, UserFlagDefinition } from "@/core/config/schema";

import siteConfig from "../../../site.config";

/**
 * 用户面 feature flag 的评估。定义在 `site.config.ts` 的 `userFlags` 段，
 * 这里不做任何 I/O：给定身份和 flag 名，结果完全确定。
 *
 * 判定顺序（见 `isEnabledFor`）：
 *   1. `userFlags.enabled` 关 → false（总开关）
 *   2. flag 没定义、或 `def.enabled` 为 false → false（单个 flag 的开关）
 *   3. `adminOnly` 且不是 admin → false；是 admin → true（adminOnly 的 flag 不分桶）
 *   4. `rollout <= 0` → false（硬关闭：非 adminOnly 的 flag 谁都不给，admin 也一样）
 *   5. 是 admin → true（灰度中的 flag 不限制自己人，先给自己看再放量）
 *   6. 未登录（userId 为 null）→ false（没身份就没法分桶）
 *   7. `rollout >= 100` → true，否则按 `sha256(userId + flagName)` 前 8 位 hex 分桶
 *
 * 这个模块 import 了 `site.config.ts`（会带上 zod），**只在服务端用**。
 * 客户端侧的值由服务端算好后经 `<FlagsProvider>` 传入（`src/core/flags/components.tsx`）。
 */

export type UserFlagsConfig = SiteConfig["userFlags"];
/** 一次评估的身份。`userId` 为 null 表示未登录。 */
export type FlagUser = { userId: string | null; isAdmin?: boolean };
/** flag 名 + 定义，按配置里的书写顺序。 */
export type NamedFlagDefinition = {
  name: string;
  definition: UserFlagDefinition;
};

/** 总开关是否打开。关闭时整个模块静默：评估恒 false、后台页面 404。 */
export function flagsEnabled(config: UserFlagsConfig = siteConfig.userFlags) {
  return config.enabled;
}

/** 所有定义，按配置顺序。后台列表和 `<FlagsProvider>` 都用它。 */
export function flagDefinitions(
  config: UserFlagsConfig = siteConfig.userFlags,
): NamedFlagDefinition[] {
  return Object.entries(config.definitions).map(([name, definition]) => ({
    name,
    definition,
  }));
}

/**
 * 确定性分桶：`sha256(userId + flagName)` 的前 8 位 hex 映射到 [0, 1)。
 * 同一个 user + flag 永远落在同一桶，所以灰度比例调大时只会有人进来、不会有人掉出去。
 */
export function flagBucket(userId: string, flagName: string): number {
  const hex = createHash("sha256")
    .update(userId + flagName)
    .digest("hex")
    .slice(0, 8);
  return Number.parseInt(hex, 16) / 0x100000000;
}

/** 给定配置评估单个 flag。纯函数：测试里直接传自己构造的 `userFlags` 段。 */
export function isEnabledFor(
  userFlags: UserFlagsConfig,
  user: FlagUser,
  flagName: string,
): boolean {
  if (!userFlags.enabled) return false;
  const def = userFlags.definitions[flagName];
  if (!def?.enabled) return false;
  const isAdmin = user.userId !== null && user.isAdmin === true;
  if (def.adminOnly && !isAdmin) return false;
  // adminOnly 的 flag 是「只给 admin 看」：admin 不参与分桶，rollout 写 0 也看得见。
  if (def.adminOnly) return true;
  // 其余的 flag，rollout 0 是硬关闭：谁都拿不到（要只给自己人就配上 adminOnly）。
  if (def.rollout <= 0) return false;
  // 灰度中的 flag 不限制自己人：先给自己看，再按比例放量。
  if (isAdmin) return true;
  // 没有身份就没法分桶，也没法判断 adminOnly，一律不可见。
  if (user.userId === null) return false;
  if (def.rollout >= 100) return true;
  return flagBucket(user.userId, flagName) < def.rollout / 100;
}

/**
 * 用站点配置评估单个 flag：`isEnabled(userId, "beta-dashboard", { isAdmin })`。
 * 服务端组件、Server Action、路由里都可以直接用。
 */
export function isEnabled(
  userId: string | null,
  flagName: string,
  options: { isAdmin?: boolean } = {},
): boolean {
  return isEnabledFor(
    siteConfig.userFlags,
    { userId, isAdmin: options.isAdmin },
    flagName,
  );
}

/**
 * 算出这个用户能看到的所有 flag，交给客户端的 `<FlagsProvider>`。
 * 总开关关闭时返回空对象：客户端拿不到任何 key，`useFlag()` 一律 false。
 */
export function resolveFlags(
  user: FlagUser,
  config: UserFlagsConfig = siteConfig.userFlags,
): Record<string, boolean> {
  if (!config.enabled) return {};
  return Object.fromEntries(
    flagDefinitions(config).map(({ name }) => [
      name,
      isEnabledFor(config, user, name),
    ]),
  );
}
