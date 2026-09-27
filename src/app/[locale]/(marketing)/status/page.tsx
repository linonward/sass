import { StatusPage, statusPageMetadata } from "@/core/status/status-page";

// 状态页每次渲染都要读库（auto 模式下还要重跑探测），不能进构建期预渲染：
// `next build` 不连数据库（见 src/core/db/index.ts 的说明）。
export const dynamic = "force-dynamic";

type Props = PageProps<"/[locale]/status">;

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return statusPageMetadata(locale);
}

/**
 * 确认 / 退订跳回来时的一次性提示。
 * 退订的链接即使签名不对也显示成功：那个人本来就不该再收到邮件。
 */
function parseNotice(query: Record<string, string | string[] | undefined>) {
  if (query.subscribed === "1") return "subscribed" as const;
  if (query.subscribed === "0") return "expired" as const;
  if (typeof query.unsubscribed === "string") return "unsubscribed" as const;
  return undefined;
}

export default async function Page({ params, searchParams }: Props) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  return <StatusPage locale={locale} notice={parseNotice(query)} />;
}
