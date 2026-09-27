import { redirect } from "next/navigation";

import { getDb } from "@/core/db";
import { localizedPath } from "@/core/seo/urls";
import { statusPageEnabled } from "@/core/status";
import {
  confirmSubscription,
  subscriberToken,
} from "@/core/status/subscribers";

// 确认要写库，不能预渲染。
export const dynamic = "force-dynamic";

/**
 * 确认订阅：邮件里的链接直接打到这里，成功或失败都跳回状态页并带一个一次性提示。
 * 令牌无效、过期、已用过都算失败 —— 已用过的令牌在 confirmSubscription 里返回 true。
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/[locale]/status/confirm">,
) {
  const { locale } = await params;
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const confirmed =
    statusPageEnabled && subscriberToken.safeParse(token).success
      ? await confirmSubscription(getDb(), token)
      : false;

  redirect(
    `${localizedPath(locale, "/status")}?subscribed=${confirmed ? "1" : "0"}`,
  );
}
