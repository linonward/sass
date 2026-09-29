import { requireAdmin } from "@/core/admin/session";
import { redirect } from "@/core/i18n/navigation";

export default async function AdminPage({
  params,
}: PageProps<"/[locale]/admin">) {
  // Check first, then redirect, so non-admins get a 404 rather than a redirect.
  await requireAdmin();
  const { locale } = await params;
  redirect({ href: "/admin/users", locale });
}
