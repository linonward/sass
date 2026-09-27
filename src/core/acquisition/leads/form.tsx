"use client";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";

export function LeadForm({
  listId,
  consentText,
}: {
  listId: string;
  consentText: string;
}) {
  const t = useTranslations("Leads");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<"limited" | "retry" | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/acquisition/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          listId,
          locale,
          email: form.get("email"),
          consent: form.get("consent") === "on",
          website: form.get("website") ?? "",
        }),
      });
      if (!response.ok) {
        setError(response.status === 429 ? "limited" : "retry");
        return;
      }
      setSent(true);
    } catch {
      setError("retry");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="space-y-2">
        <Label htmlFor={`lead-email-${listId}`}>{t("email")}</Label>
        <Input
          id={`lead-email-${listId}`}
          name="email"
          type="email"
          autoComplete="email"
          maxLength={254}
          required
        />
      </div>
      <div className="hidden" aria-hidden="true">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <label className="flex min-h-10 items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="consent"
          required
          className="accent-primary mt-1 size-5 shrink-0"
        />
        <span>{consentText}</span>
      </label>
      <Button type="submit" size="marketing" tone="primary" disabled={busy}>
        {busy ? t("sending") : sent ? t("resend") : t("submit")}
      </Button>
      {sent && (
        <p role="status" className="text-muted-foreground text-sm">
          {t("sent")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {t(error)}
        </p>
      )}
    </form>
  );
}
