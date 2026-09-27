"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { SIGN_IN_PATH } from "@/core/auth/routes";
import { auth } from "@/core/auth/server";
import { getDb } from "@/core/db";
import { localizedPath } from "@/core/seo/urls";

import { createApiKeyService } from "./service";

import siteConfig from "../../../site.config";

export type CreateKeyState =
  | { status: "idle" }
  // 明文只在这一份返回值里出现一次，界面显示完就不再可得。
  | { status: "created"; plaintext: string; name: string }
  | { status: "error"; error: "invalid_name" | "duplicate" | "unavailable" };

export type RevokeKeyState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; error: "invalid" | "unavailable" };

// 主键是 uuid：先挡掉乱填的值，别把非 uuid 的字符串丢给 Postgres（那里会直接报错）。
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireUserId(locale: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(localizedPath(locale, SIGN_IN_PATH));
  return session.user.id;
}

/** 新建一把 key，返回一次性明文。 */
export async function createApiKey(
  locale: string,
  _prev: CreateKeyState,
  form: FormData,
): Promise<CreateKeyState> {
  // 关闭模块后页面和表单都不存在；这里再挡一次，免得直接调 action 也能建 key。
  if (!siteConfig.apiKeys.enabled) {
    return { status: "error", error: "unavailable" };
  }
  const userId = await requireUserId(locale);
  const name = String(form.get("name") ?? "").trim();
  const result = await createApiKeyService(getDb()).create(userId, name);
  if (!result.ok) return { status: "error", error: result.reason };
  // 弹层背后的列表要立刻多出这一把（action 不会自己刷新页面，得显式说一声）。
  // 刷新只重渲染服务端组件，弹层里的明文来自 action 返回值，照旧留着。
  refresh();
  return {
    status: "created",
    plaintext: result.plaintext,
    name: result.key.name,
  };
}

/**
 * 撤销一把 key。幂等：已经撤销过的（或不属于自己的）也返回成功 ——
 * 两个标签页同时撤销同一把 key 不该看到报错。
 */
export async function revokeApiKey(
  locale: string,
  _prev: RevokeKeyState,
  form: FormData,
): Promise<RevokeKeyState> {
  if (!siteConfig.apiKeys.enabled) {
    return { status: "error", error: "unavailable" };
  }
  const userId = await requireUserId(locale);
  const keyId = String(form.get("keyId") ?? "");
  if (!UUID_PATTERN.test(keyId)) return { status: "error", error: "invalid" };
  // 没改动任何行（已经撤销过、或这个 id 不属于当前用户）也返回成功：
  // 两种情况下这把 key 都不可用，而按 keyId 静默失败只会让用户在两个标签页之间来回猜。
  await createApiKeyService(getDb()).revoke(userId, keyId);
  // 列表上的状态徽章由服务端渲染，撤销后要让页面重新渲染一次才能变成「已撤销」。
  refresh();
  return { status: "success" };
}
