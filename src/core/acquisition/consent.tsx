"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/core/ui/button";
import { browserEntry, type EntryContext } from "./context";

const endpoint = "/api/acquisition/attribution";
const preferenceKey = "acquisition-source-choice";
function rememberDecline(declined: boolean) {
  try {
    if (declined) localStorage.setItem(preferenceKey, "declined");
    else localStorage.removeItem(preferenceKey);
  } catch {
    /* Optional storage may be blocked. */
  }
}
function declined() {
  try {
    return localStorage.getItem(preferenceKey) === "declined";
  } catch {
    return false;
  }
}
async function post(body: unknown) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("request_failed");
  return response;
}

export function AttributionConsent() {
  const t = useTranslations("Acquisition");
  const pathname = usePathname();
  const entry = useRef<EntryContext | null>(null);
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    entry.current ??= browserEntry(window.location.href, document.referrer);
    let active = true;
    void fetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("request_failed");
        const status = (await response.json()) as {
          accepted: boolean;
          pending: boolean;
        };
        if (!active) return;
        setAccepted(status.accepted);
        setReady(true);
        if (!status.accepted && !declined()) setOpen(true);
        if (status.pending) await post({ action: "sync" });
      })
      .catch(() => {
        if (active) {
          setReady(true);
          setError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [pathname]);

  async function choose(action: "accept" | "withdraw") {
    setBusy(true);
    setError(false);
    setNotice("");
    try {
      await post(
        action === "accept" ? { action, entry: entry.current } : { action },
      );
      const allow = action === "accept";
      rememberDecline(!allow);
      setAccepted(allow);
      setOpen(false);
      setNotice(allow ? t("saved") : t("removed"));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      aria-label={t("title")}
      className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-xl"
    >
      {open ? (
        <div className="sticker bg-card rounded-xl p-5">
          <h2 className="heading-display text-lg">{t("title")}</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            {t("description")}
          </p>
          <p className="mt-2 text-sm">
            {accepted ? t("enabled") : t("disabled")}
          </p>
          {error && (
            <p role="alert" className="text-destructive mt-2 text-sm">
              {t("error")}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              size="marketing"
              tone="primary"
              disabled={busy || !ready}
              onClick={() => choose("accept")}
            >
              {t("accept")}
            </Button>
            <Button
              size="marketing"
              variant="outline"
              disabled={busy || !ready}
              onClick={() => choose("withdraw")}
            >
              {accepted ? t("withdraw") : t("reject")}
            </Button>
            <Button
              size="marketing"
              variant="ghost"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {t("close")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span role="status" className="bg-background text-sm">
            {notice}
          </span>
          <Button
            size="marketing"
            variant="outline"
            className="bg-background"
            onClick={() => setOpen(true)}
          >
            {t("preferences")}
          </Button>
        </div>
      )}
    </aside>
  );
}
