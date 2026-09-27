"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * 客户端侧的 feature flag。值由服务端用 `resolveFlags()` 算好后经 `<FlagsProvider>` 传下来：
 * 判定用的配置在 `site.config.ts`，把它 import 进客户端组件会把 zod 拖进每个页面的 bundle
 * （见 `src/core/i18n/locales.ts` 里同样的取舍），所以客户端只拿到一个 boolean 快照。
 *
 * provider 挂在 `DashboardShell` 上，覆盖登录后的所有页面（产品面 + 后台）。
 * 公开页面要在服务端分支就用 `isEnabled()`；客户端组件要用 flag 就放在登录后的页面里。
 */

const FlagsContext = createContext<Readonly<Record<string, boolean>> | null>(
  null,
);

/** 把这次请求算好的 flag 值交给客户端组件。服务端组件里用，值必须是纯数据。 */
export function FlagsProvider({
  values,
  children,
}: {
  values: Readonly<Record<string, boolean>>;
  children: ReactNode;
}) {
  return (
    <FlagsContext.Provider value={values}>{children}</FlagsContext.Provider>
  );
}

/**
 * 读一个 flag。两个默认值都是 false：没有 provider（比如公开页面）或快照里没有这个
 * flag（总开关关着、或者名字写错了）时不报错、一律当作关闭 —— 开关只在显式打开时生效。
 */
export function useFlag(name: string): boolean {
  return useContext(FlagsContext)?.[name] ?? false;
}

/**
 * 按 flag 渲染。关着的时候渲染 `fallback`（默认什么都不渲染）。
 *
 * ```tsx
 * <FeatureFlag name="beta-dashboard" fallback={<OldDashboard />}>
 *   <NewDashboard />
 * </FeatureFlag>
 * ```
 */
export function FeatureFlag({
  name,
  fallback = null,
  children,
}: {
  name: string;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return <>{useFlag(name) ? children : fallback}</>;
}
