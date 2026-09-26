"use client";

/**
 * Google One Tap：登录页弹出的账号提示，点一下头像即完成登录（不再整页跳去 Google）。
 *
 * **为什么单独建一个客户端实例**，而不是把插件挂到 `client.ts` 的共享 `authClient` 上：
 * `createAuthClient` 的插件列表是模块级静态的，而 client ID 只有服务端在运行期才知道
 * （预览部署还会刻意禁用，见 `env.ts` 的 `googleClientId`）。这里按需创建并按 clientId
 * 缓存，clientId 由服务端作为 prop 传下来，「Google 是否可用」全站只有一个判断。
 *
 * 这是客户端叶子模块：**不要 import `./env` 或 `site.config.ts`**，那会把 zod 和配置
 * schema 拖进登录页的客户端 bundle（见 `src/core/i18n/locales.ts` 的注释）。
 */

import { oneTapClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { withLocaleHeader } from "./locale";

function buildClient(clientId: string) {
  return createAuthClient({
    plugins: [
      oneTapClient({
        clientId,
        // `autoSelect` 不写在这里：插件实现里 `auto_select` 取的是**每次调用**的参数
        // （插件级那个字段传不到 GIS），所以关掉静默登录写在 signInWithOneTap 里。
        context: "signin",
      }),
    ],
    fetchOptions: { onRequest: withLocaleHeader },
  });
}

let cached: {
  clientId: string;
  client: ReturnType<typeof buildClient>;
} | null = null;

function getClient(clientId: string) {
  if (cached?.clientId !== clientId) {
    cached = { clientId, client: buildClient(clientId) };
  }
  return cached.client;
}

/**
 * 提示为什么没弹出来。这是唯一能拿到的诊断信号，且只在开发环境打印：
 * 最常见的原因是 Google Cloud Console 里没登记当前 origin（`unregistered_origin`），
 * 表现是完全静默 —— 提示不出现，也没有任何报错。
 */
function logPromptNotification(notification?: unknown) {
  if (process.env.NODE_ENV === "production") return;
  try {
    const reason = (
      notification as { getNotDisplayedReason?: () => string } | undefined
    )?.getNotDisplayedReason?.();
    console.info(`[auth] One Tap 提示未显示${reason ? `：${reason}` : ""}`);
  } catch {
    // FedCM 下部分 notification 方法不可用，拿不到诊断信息就算了。
  }
}

export type OneTapSignInOptions = {
  /** Google client ID（公开值），由服务端判断可用后传下来。 */
  clientId: string;
  /** 登录成功后跳转的站内地址（已清洗，含语言前缀）。 */
  callbackURL: string;
  /** 失败时调用，用来复用登录页现有的错误提示。 */
  onError: () => void;
};

/**
 * 弹出 One Tap 提示。用户关掉提示不算失败 —— 静默结束，页面上的 Google 按钮和
 * 邮箱验证码照常可用。
 */
export async function signInWithOneTap({
  clientId,
  callbackURL,
  onError,
}: OneTapSignInOptions) {
  try {
    await getClient(clientId).oneTap({
      // callbackURL 必须一路带着：插件判断要不要跳转的表达式是
      // `(!opts.fetchOptions && !fetchOptions) || opts.callbackURL`，
      // 传了 fetchOptions 却不传 callbackURL 会静默不跳转 —— session 建好了，
      // 页面却停在原地，也不报错。
      callbackURL,
      // 关掉静默登录是硬要求：本站登出走 Server Action（`actions.ts`），better-auth
      // 客户端插件里那条 FedCM 的 `preventSilentAccess` 钩子不会触发，开着 autoSelect
      // 会让用户登出后被 Google 会话直接送回登录态。
      // 必须写在这里而不是 `oneTapClient({ ... })`：插件实现里 `auto_select` 取的是每次
      // 调用的参数，插件级那个字段根本传不到 GIS（GIS 自己的默认值也是 false，但那是碰巧）。
      autoSelect: false,
      fetchOptions: {
        // 回调失败时插件自己只是静默 return，错误只能从这里冒出来。
        onError,
      },
      onPromptNotification: logPromptNotification,
    });
  } catch {
    // GIS 脚本加载失败：被 CSP 拦掉、被广告拦截插件拦掉、网络不通。插件内部已经
    // console.error 过一次。
    //
    // 这里**不报错给用户**：脚本加载失败发生在用户做任何操作之前（常见于广告拦截插件
    // 屏蔽 accounts.google.com），弹一条「Google 登录失败」只会让人困惑 —— 他本来可能
    // 只想用邮箱验证码登录。真正该报的是「点了提示之后回调失败」，那条走 fetchOptions.onError。
  }
}
