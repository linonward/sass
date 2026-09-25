import { getLocale, getTranslations } from "next-intl/server";

import { Button } from "@/core/ui/button";

import { signOut } from "./actions";

export async function SignOutButton() {
  const locale = await getLocale();
  const t = await getTranslations("Auth");

  return (
    <form action={signOut.bind(null, locale)}>
      <Button type="submit" variant="outline">
        {t("signOut")}
      </Button>
    </form>
  );
}
