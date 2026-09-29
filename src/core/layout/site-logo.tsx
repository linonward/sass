import { Link } from "@/core/i18n/navigation";
import { BrandMark } from "@/core/layout/brand-mark";

import siteConfig from "../../../site.config";

export function SiteLogo() {
  return (
    <Link
      href="/"
      className="font-display flex items-center gap-3 text-2xl font-bold"
    >
      <BrandMark className="size-9" />
      <span>{siteConfig.name}</span>
    </Link>
  );
}
