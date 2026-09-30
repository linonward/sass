import { getTranslations } from "next-intl/server";

import { SIGN_IN_PATH } from "@/core/auth/routes";
import { localizedPath } from "@/core/seo/urls";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";

import siteConfig from "../../../site.config";
import { DeviceList } from "./device-list";
import { listDevices } from "./devices";
import { ChangeEmailForm } from "./security-forms";

/**
 * The account security cards on the settings page: changing the email (only when
 * `auth.changeEmail.enabled`) and the signed-in devices.
 */
export async function SecuritySection({
  locale,
  userId,
  email,
  sessionId,
  changeEmail = siteConfig.auth.changeEmail,
}: {
  locale: string;
  userId: string;
  email: string;
  sessionId: string;
  /** Defaults to site.config.ts; injectable so the disabled case can be tested. */
  changeEmail?: { enabled: boolean; verifyCurrentEmail: boolean };
}) {
  const t = await getTranslations({ locale, namespace: "Account" });
  const devices = await listDevices(userId, sessionId);

  return (
    <>
      {changeEmail.enabled && (
        <Card>
          <CardHeader>
            <CardTitle>{t("email.title")}</CardTitle>
            <CardDescription>{t("email.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ChangeEmailForm
              currentEmail={email}
              verifyCurrentEmail={changeEmail.verifyCurrentEmail}
              resendCooldown={siteConfig.auth.emailOtp.resendCooldown}
              signInHref={localizedPath(locale, SIGN_IN_PATH)}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("devices.title")}</CardTitle>
          <CardDescription>{t("devices.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <DeviceList locale={locale} devices={devices} />
        </CardContent>
      </Card>
    </>
  );
}
