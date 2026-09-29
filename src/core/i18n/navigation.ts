import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

// Use the Link / useRouter from here for all in-site navigation; they add the current locale prefix.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
