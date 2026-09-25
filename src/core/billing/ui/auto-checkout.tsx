"use client";

import { Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

import { useCheckout } from "./use-checkout";

/** 登录后回到 /pricing?plan=<id> 时自动继续结账。 */
export function AutoCheckout({ planId }: { planId: string }) {
  const t = useTranslations("Billing");
  const { start, error } = useCheckout();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start(planId);
  }, [planId, start]);

  return (
    <div
      role="status"
      className="bg-muted/50 mx-auto mb-10 flex max-w-xl items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm"
    >
      {error ? (
        <span role="alert" className="text-destructive">
          {t(`errors.${error}`)}
        </span>
      ) : (
        <>
          <Loader2Icon className="size-4 animate-spin" aria-hidden />
          {t("actions.redirecting")}
        </>
      )}
    </div>
  );
}
