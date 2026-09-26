import { Link } from "@/core/i18n/navigation";
import { BrandMark } from "@/core/layout/brand-mark";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/core/ui/sidebar";

import siteConfig from "../../../site.config";

/** 侧边栏顶部的品牌区；折叠时只显示 logo。 */
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
