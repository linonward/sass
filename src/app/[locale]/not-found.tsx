import { useTranslations } from "next-intl";

import { Link } from "@/core/i18n/navigation";
import { buttonVariants } from "@/core/ui/button";

export default function NotFound() {
  const t = useTranslations("NotFound");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <title>{t("title")}</title>
      <p className="text-primary text-sm font-medium">404</p>
      <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-muted-foreground">{t("description")}</p>
      <Link href="/" className={buttonVariants()}>
        {t("back")}
      </Link>
    </main>
  );
}
