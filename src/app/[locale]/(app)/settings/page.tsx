import { getTranslations } from "next-intl/server";

import { preferredLocale } from "@/core/account/locale";
import {
  DeleteAccount,
  LocaleForm,
  NameForm,
} from "@/core/account/settings-forms";
import { getSession } from "@/core/auth/session";
import { routing } from "@/core/i18n/routing";
import { buildMetadata } from "@/core/seo/metadata";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";

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
  // (app) 的 layout 已确保已登录。
  const user = (await getSession())!.user;

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>

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

      <Card className="border-destructive/40">
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
