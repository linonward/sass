import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { notFound } from "next/navigation";
import * as rootParams from "next/root-params";

import { withOverlayMessages } from "@/core/config/overlay";

import { routing } from "./routing";

export default getRequestConfig(async ({ locale: requested }) => {
  // An explicitly passed locale (such as params.locale in generateMetadata) must be validated too,
  // otherwise paths like /missing.png would try to load a messages file that doesn't exist.
  const locale = requested ?? (await rootParams.locale());
  if (!hasLocale(routing.locales, locale)) notFound();

  return {
    locale,
    // A deployment can swap in its own home page copy via SITE_OVERLAY_DIR (see core/config/overlay.ts).
    messages: withOverlayMessages(
      locale,
      (await import(`../../../messages/${locale}.json`)).default,
    ),
  };
});
