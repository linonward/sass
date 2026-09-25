import Link from "next/link";

import siteConfig from "../../../site.config";

export function SiteLogo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold">
      {/* eslint-disable-next-line @next/next/no-img-element -- logo 可能是任意格式的 SVG，无需优化 */}
      <img src={siteConfig.brand.logo} alt="" className="size-6" />
      <span>{siteConfig.name}</span>
    </Link>
  );
}
