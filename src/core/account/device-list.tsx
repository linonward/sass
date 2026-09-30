import { getFormatter, getTranslations } from "next-intl/server";

import { Badge } from "@/core/ui/badge";

import type { Device } from "./devices";
import { SignOutDeviceButton, SignOutOthersDialog } from "./security-forms";

/**
 * The signed-in devices: this one first, then the rest by last activity. Times are relative ("3
 * hours ago") so they read the same whatever time zone the server renders in.
 */
export async function DeviceList({
  locale,
  devices,
}: {
  locale: string;
  devices: Device[];
}) {
  const t = await getTranslations({ locale, namespace: "Account.devices" });
  const format = await getFormatter({ locale });
  const now = new Date();

  function name(device: Device) {
    const { label } = device;
    if (label.kind === "unknown") return t("unknownDevice");
    if (label.kind === "raw") return label.text;
    if (label.browser && label.os)
      return t("browserOnOs", { browser: label.browser, os: label.os });
    return label.browser ?? label.os ?? t("unknownDevice");
  }

  const others = devices.filter((device) => !device.current);

  return (
    <div className="flex flex-col gap-4">
      <ul aria-label={t("title")} className="flex flex-col">
        {devices.map((device) => (
          <li
            key={device.id}
            data-testid="device-row"
            className="border-border flex flex-col gap-2 border-t py-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium break-words">{name(device)}</span>
                {device.current && (
                  <Badge variant="band" flat>
                    {t("current")}
                  </Badge>
                )}
                {device.impersonated && (
                  <Badge variant="warning" flat>
                    {t("impersonated")}
                  </Badge>
                )}
              </div>
              <p className="text-muted-foreground text-sm">
                {t("meta", {
                  ip: device.ipAddress ?? t("unknownIp"),
                  active: format.relativeTime(device.lastActiveAt, now),
                })}
              </p>
            </div>
            {!device.current && (
              <SignOutDeviceButton sessionId={device.id} label={name(device)} />
            )}
          </li>
        ))}
      </ul>
      {others.length > 0 ? (
        <div>
          <SignOutOthersDialog />
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{t("onlyThis")}</p>
      )}
    </div>
  );
}
