"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";

/**
 * Shows and copies the referral link. If copying fails (no clipboard permission, insecure context),
 * fall back to manual copy: select the input's contents and show a keyboard hint instead of
 * pretending it was copied.
 */
export function CopyLink({ link }: { link: string }) {
  const t = useTranslations("Referrals");
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setState("copied");
    } catch {
      const field = document.getElementById("referral-link");
      if (field instanceof HTMLInputElement) field.select();
      setState("manual");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="referral-link">
          {t("linkLabel")}
        </label>
        <Input
          id="referral-link"
          data-testid="referral-link"
          readOnly
          value={link}
          className="font-mono text-xs sm:text-sm"
        />
        <Button
          type="button"
          variant="outline"
          className="sm:w-40"
          data-testid="referral-copy"
          data-state={state}
          onClick={copy}
        >
          {state === "copied" ? t("copied") : t("copy")}
        </Button>
      </div>
      {state === "manual" && (
        <p className="text-muted-foreground text-sm">{t("copyManual")}</p>
      )}
    </div>
  );
}
