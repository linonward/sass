"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/core/ui/button";
import { Link } from "@/core/i18n/navigation";
export function LeadActionForm({ mode }: { mode: "confirm" | "withdraw" }) {
  const t = useTranslations("Leads");
  const [state, setState] = useState<
    "idle" | "busy" | "done" | "expired" | "retry"
  >("idle");
  async function act() {
    const token = new URLSearchParams(window.location.hash.slice(1)).get(
      "token",
    );
    if (!token) {
      setState("expired");
      return;
    }
    setState("busy");
    try {
      const response = await fetch("/api/acquisition/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: mode, token }),
      });
      if (!response.ok) {
        setState(response.status === 400 ? "expired" : "retry");
        return;
      }
      setState("done");
      window.history.replaceState(null, "", window.location.pathname);
    } catch {
      setState("retry");
    }
  }
  return (
    <div className="space-y-5">
      <p className="text-muted-foreground">{t(`${mode}.description`)}</p>
      {state === "done" ? (
        <p role="status">{t(`${mode}.done`)}</p>
      ) : (
        <Button
          size="marketing"
          tone="primary"
          disabled={state === "busy"}
          onClick={act}
        >
          {t(`${mode}.button`)}
        </Button>
      )}
      {(state === "expired" || state === "retry") && (
        <p role="alert" className="text-destructive">
          {t(state)}
        </p>
      )}
      <p>
        <Link href="/waitlist" className="text-primary-text underline">
          {t("back")}
        </Link>
      </p>
    </div>
  );
}
