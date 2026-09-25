import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

// 站内跳转统一用这里的 Link / useRouter，自动带上当前语言前缀。
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
