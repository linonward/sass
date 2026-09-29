import { Link } from "@/core/i18n/navigation";
import { BrandMark } from "@/core/layout/brand-mark";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/core/ui/sidebar";

import siteConfig from "../../../site.config";

/** Brand area at the top of the sidebar; shows only the logo when collapsed. */
export function SidebarBrand() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" render={<Link href="/" />}>
          <BrandMark className="size-8 shrink-0" />
          <span className="truncate font-semibold">{siteConfig.name}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
