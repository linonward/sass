import { requireAdmin } from "@/core/admin/session";
import { redirect } from "@/core/i18n/navigation";

export default async function AdminPage({
  params,
}: PageProps<"/[locale]/admin">) {
  // 先校验再跳转，非管理员看到的是 404 而不是跳转。
  await requireAdmin();
  const { locale } = await params;
  redirect({ href: "/admin/users", locale });
}
