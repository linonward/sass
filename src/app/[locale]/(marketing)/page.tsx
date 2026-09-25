import { useTranslations } from "next-intl";

import { Link } from "@/core/i18n/navigation";
import { buttonVariants } from "@/core/ui/button";

import siteConfig from "../../../../site.config";

// 占位首页，T105 替换为落地页区块。
export default function Home() {
  const t = useTranslations();

  return (
    <section className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 py-24 text-center">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        {siteConfig.name}
      </h1>
      <p className="text-muted-foreground text-lg">{t("Footer.tagline")}</p>
      <Link href="/#pricing" className={buttonVariants({ size: "lg" })}>
        {t("Home.cta")}
      </Link>
    </section>
  );
}
