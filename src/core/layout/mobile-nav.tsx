"use client";

import { MenuIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Link } from "@/core/i18n/navigation";
import { Button } from "@/core/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/core/ui/sheet";

export function MobileNav({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string }[];
}) {
  const t = useTranslations("Header");
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={t("openMenu")}
          />
        }
      >
        <MenuIcon />
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-1 px-4" aria-label={t("mobile")}>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="hover:bg-muted rounded-md px-2 py-2 text-base"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
