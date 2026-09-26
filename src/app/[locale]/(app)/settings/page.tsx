import { getTranslations } from "next-intl/server";

import { preferredLocale } from "@/core/account/locale";
import {
  DeleteAccount,
  LocaleForm,
  NameForm,
} from "@/core/account/settings-forms";
import { requirePageSession } from "@/core/auth/session";
import { routing } from "@/core/i18n/routing";
import { buildMetadata } from "@/core/seo/metadata";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { PageHeader } from "@/core/ui/page-header";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/settings">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Account" });
  return buildMetadata({
    locale,
    path: "/settings",
    title: t("metaTitle"),
    noIndex: true,
  });
}

export default async function SettingsPage({
  params,
}: PageProps<"/[locale]/settings">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Account" });
  const { user } = await requirePageSession(locale);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("profile.title")}</CardTitle>
          <CardDescription>
            {t("profile.email", { email: user.email })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <NameForm name={user.name} />
          {routing.locales.length > 1 && (
            <LocaleForm
              locales={routing.locales}
              current={user.locale ?? preferredLocale({ locale })}
            />
          )}
        </CardContent>
      </Card>

      {/* 危险区：面板默认是中性描边，这里换成语义描边（平描边，没有唇边）。 */}
      <Card className="border-[var(--destructive-edge)]">
        <CardHeader>
          <CardTitle>{t("danger.title")}</CardTitle>
          <CardDescription>{t("danger.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteAccount email={user.email} />
        </CardContent>
      </Card>
    </div>
  );
}
