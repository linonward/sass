import Link from "next/link";

import { buttonVariants } from "@/core/ui/button";

import siteConfig from "../../../site.config";

// 占位首页，T105 替换为落地页区块。
export default function Home() {
  return (
    <section className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 py-24 text-center">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        {siteConfig.name}
      </h1>
      <p className="text-muted-foreground text-lg">{siteConfig.description}</p>
      <Link href="/#pricing" className={buttonVariants({ size: "lg" })}>
        Get started
      </Link>
    </section>
  );
}
