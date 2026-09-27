"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { getAdminSession } from "@/core/admin/session";
import { getDb } from "@/core/db";
import {
  statusEventStatuses,
  type StatusEventStatus,
} from "@/core/db/schema/status";
import { sendEmail } from "@/core/email";
import { siteLink } from "@/core/email/links";
import { routing } from "@/core/i18n/routing";
import { runAfterResponse } from "@/core/lib/after-response";
import { logger } from "@/core/observability/logger";
import { checkRateLimit, getClientIp } from "@/core/ratelimit";

import siteConfig from "../../../site.config";
import { statusPageEnabled } from "./index";
import { notifySubscribers } from "./notify";
import { createIncident, resolveIncident, updateIncident } from "./store";
import { prepareSubscription, subscriberEmail } from "./subscribers";

/** incident 说明的长度上限。状态页首屏是一眼看完的，长文留给博客。 */
const MAX_MESSAGE = 500;

export type StatusErrorCode =
  | "forbidden"
  | "unknownComponent"
  | "invalidStatus"
  | "messageRequired"
  | "notFound"
  | "generic";

export type StatusActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; error: StatusErrorCode };

// Server Action 可以绕过页面直接调用，所以每个 action 都重新校验管理员身份。
const forbidden: StatusActionState = { status: "error", error: "forbidden" };

/** 组件必须是 `site.config.ts` 里登记过的 key；客户端传来的值一律不信。 */
function parseComponent(value: FormDataEntryValue | null): string | null {
  const component = String(value ?? "");
  return component in siteConfig.statusPage.components ? component : null;
}

function parseStatus(
  value: FormDataEntryValue | null,
): StatusEventStatus | null {
  const status = String(value ?? "");
  return (statusEventStatuses as readonly string[]).includes(status)
    ? (status as StatusEventStatus)
    : null;
}

function parseMessage(value: FormDataEntryValue | null): string | null {
  const message = String(value ?? "")
    .trim()
    .slice(0, MAX_MESSAGE);
  return message.length > 0 ? message : null;
}

/**
 * 通知订阅者。放在 `runAfterResponse` 里：发信是这次操作的副作用，
 * 不该让管理员多等一轮 SMTP，失败也只记日志（那条 incident 已经在库里了）。
 */
async function announce(event: Parameters<typeof notifySubscribers>[1]) {
  await runAfterResponse(async () => {
    try {
      await notifySubscribers(getDb(), event);
    } catch (error) {
      logger.error("status.notify_failed", { error, incidentId: event.id });
    }
  });
}

/** 开一条 incident（`operational` 用来发没有影响的公告）。 */
export async function createIncidentAction(
  _prev: StatusActionState,
  form: FormData,
): Promise<StatusActionState> {
  const session = await getAdminSession();
  if (!session || !statusPageEnabled) return forbidden;

  const component = parseComponent(form.get("component"));
  if (!component) return { status: "error", error: "unknownComponent" };
  const status = parseStatus(form.get("status"));
  if (!status) return { status: "error", error: "invalidStatus" };
  const message = parseMessage(form.get("message"));
  if (!message) return { status: "error", error: "messageRequired" };

  const event = await createIncident(getDb(), { component, status, message });
  await announce(event);
  refresh();
  return { status: "success" };
}

/** 更新进行中的 incident：改影响级别或改说明（同一行的创建和解决仍是一条时间线）。 */
export async function updateIncidentAction(
  _prev: StatusActionState,
  form: FormData,
): Promise<StatusActionState> {
  const session = await getAdminSession();
  if (!session || !statusPageEnabled) return forbidden;

  const id = String(form.get("id") ?? "");
  const status = parseStatus(form.get("status"));
  if (!status) return { status: "error", error: "invalidStatus" };
  const message = parseMessage(form.get("message"));
  if (!message) return { status: "error", error: "messageRequired" };

  const event = await updateIncident(getDb(), id, { status, message });
  if (!event) return { status: "error", error: "notFound" };

  await announce(event);
  refresh();
  return { status: "success" };
}

/** 解决：`status` 保留当时的影响级别，时间线上仍然看得出「当时是 outage」。 */
export async function resolveIncidentAction(
  _prev: StatusActionState,
  form: FormData,
): Promise<StatusActionState> {
  const session = await getAdminSession();
  if (!session || !statusPageEnabled) return forbidden;

  const event = await resolveIncident(getDb(), String(form.get("id") ?? ""));
  if (!event) return { status: "error", error: "notFound" };

  await announce(event);
  refresh();
  return { status: "success" };
}

export type SubscribeErrorCode =
  "invalidEmail" | "rateLimited" | "unavailable" | "generic";

export type SubscribeState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; error: SubscribeErrorCode };

/**
 * 订阅状态通知：写入待确认的地址，并发一封确认信。
 *
 * 已经确认过的地址、以及 60 秒内的重复提交都不发信，但返回的成功文案是同一句 ——
 * 表单不该成为一个「这个地址订没订过」的探测接口。
 */
export async function subscribeAction(
  _prev: SubscribeState,
  form: FormData,
): Promise<SubscribeState> {
  if (!statusPageEnabled) return { status: "error", error: "unavailable" };
  const parsed = subscriberEmail.safeParse(String(form.get("email") ?? ""));
  if (!parsed.success) return { status: "error", error: "invalidEmail" };

  // 蜜罐：真人看不见这个字段，填了的都是脚本；对外仍然返回成功。
  if (String(form.get("website") ?? "")) return { status: "success" };

  const requestHeaders = await headers();
  const limit = await checkRateLimit("statusSubscribe", {
    ip: getClientIp(requestHeaders),
  });
  if (!limit.ok) return { status: "error", error: "rateLimited" };

  const requested = String(form.get("locale") ?? "");
  const locale = (routing.locales as readonly string[]).includes(requested)
    ? requested
    : routing.defaultLocale;

  try {
    const pending = await prepareSubscription(getDb(), {
      email: parsed.data,
      locale,
    });
    if (pending) {
      await sendEmail({
        to: pending.email,
        template: "status-subscription",
        props: {
          confirmUrl: siteLink(
            locale,
            `/status/confirm?token=${pending.confirmToken}`,
          ),
        },
        locale,
      });
    }
  } catch (error) {
    logger.error("status.subscribe_failed", { error });
    return { status: "error", error: "generic" };
  }
  return { status: "success" };
}
