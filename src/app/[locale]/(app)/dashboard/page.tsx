import { getTranslations } from "next-intl/server";

import { getSession } from "@/core/auth/session";
import { SignOutButton } from "@/core/auth/sign-out-button";
import { buildMetadata } from "@/core/seo/metadata";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/dashboard">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth.dashboard" });
  return buildMetadata({
    locale,
    path: "/dashboard",
    title: t("metaTitle"),
    noIndex: true,
  });
}

// 占位页：T204 替换为完整的 dashboard。
export default async function DashboardPage({
  params,
}: PageProps<"/[locale]/dashboard">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth.dashboard" });
  const session = await getSession();

  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-muted-foreground" data-testid="signed-in-as">
        {t("signedInAs", { email: session?.user.email ?? "" })}
      </p>
      <SignOutButton />
    </div>
  );
}
