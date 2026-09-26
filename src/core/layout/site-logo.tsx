import { Link } from "@/core/i18n/navigation";
import { BrandMark } from "@/core/layout/brand-mark";

import siteConfig from "../../../site.config";

export function SiteLogo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold">
      <BrandMark className="size-6" />
      <span>{siteConfig.name}</span>
    </Link>
  );
}
