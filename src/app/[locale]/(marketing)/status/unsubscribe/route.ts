import { redirect } from "next/navigation";

import { getDb } from "@/core/db";
import { localizedPath } from "@/core/seo/urls";
import { statusPageEnabled } from "@/core/status";
import { withdrawSubscription } from "@/core/status/subscribers";

// 退订要写库，不能预渲染。
export const dynamic = "force-dynamic";

/**
 * 退订：通知邮件底部那条永久链接打到这里。签名不对时不删任何东西，
 * 但对外仍然是「已退订」—— 这个人的诉求就是别再收到邮件。
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/[locale]/status/unsubscribe">,
) {
  const { locale } = await params;
  const query = new URL(request.url).searchParams;
  if (statusPageEnabled) {
    await withdrawSubscription(getDb(), {
      email: query.get("email") ?? "",
      signature: query.get("signature") ?? "",
    });
  }

  redirect(`${localizedPath(locale, "/status")}?unsubscribed=1`);
}
