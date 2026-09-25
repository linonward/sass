"use client";

import {
  ChevronsUpDownIcon,
  LanguagesIcon,
  LogOutIcon,
  SettingsIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId } from "react";

import { nativeName, useSwitchLocale } from "@/core/i18n/locale-switcher";
import { Link } from "@/core/i18n/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/core/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/core/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/core/ui/sidebar";

export type MenuUser = { name: string; email: string; image?: string | null };

/** 头像缺省时显示的首字母：优先取名称，没有名称时取邮箱。 */
export function initials({ name, email }: Pick<MenuUser, "name" | "email">) {
  const source = name.trim() || email;
  const words = source.split(/[\s@._-]+/).filter(Boolean);
  const letters =
    words.length > 1 && name.trim()
      ? `${words[0][0]}${words[1][0]}`
      : source.slice(0, 1);
  return letters.toUpperCase();
}

function UserAvatar({ user }: { user: MenuUser }) {
  return (
    <Avatar className="size-8 rounded-lg">
      {user.image && <AvatarImage src={user.image} alt="" />}
      <AvatarFallback className="rounded-lg">{initials(user)}</AvatarFallback>
    </Avatar>
  );
}

export function UserMenu({
  user,
  locales,
  signOut,
}: {
  user: MenuUser;
  locales: readonly string[];
  /** 退出登录的 Server Action（已绑定语言）。 */
  signOut: () => Promise<void>;
}) {
  const t = useTranslations("Dashboard.userMenu");
  const locale = useLocale();
  const switchTo = useSwitchLocale();
  const { isMobile } = useSidebar();
  const formId = useId();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {/* 菜单弹层渲染在 portal 里，退出按钮通过 form 属性提交这个表单。 */}
        <form id={formId} action={signOut} hidden />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                aria-label={t("open")}
                className="data-popup-open:bg-sidebar-accent"
              />
            }
          >
            <UserAvatar user={user} />
            <span className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">
                {user.name || user.email}
              </span>
              <span className="text-muted-foreground truncate text-xs">
                {user.email}
              </span>
            </span>
            <ChevronsUpDownIcon className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
            className="w-(--anchor-width) min-w-56"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center gap-2 font-normal">
                <UserAvatar user={user} />
                <span className="grid min-w-0 text-sm leading-tight">
                  <span className="truncate font-medium">
                    {user.name || user.email}
                  </span>
                  <span
                    className="text-muted-foreground truncate text-xs"
                    data-testid="user-menu-email"
                  >
                    {user.email}
                  </span>
                </span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/settings" />}>
              <SettingsIcon />
              {t("settings")}
            </DropdownMenuItem>
            {locales.length > 1 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <LanguagesIcon />
                  {t("language")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={locale}
                    onValueChange={(next: string) => switchTo(next)}
                  >
                    {locales.map((l) => (
                      <DropdownMenuRadioItem key={l} value={l} lang={l}>
                        {nativeName(l)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              render={<button type="submit" form={formId} className="w-full" />}
            >
              <LogOutIcon />
              {t("signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
