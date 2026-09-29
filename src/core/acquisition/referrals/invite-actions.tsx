"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { useRouter } from "@/core/i18n/navigation";
import { Button } from "@/core/ui/button";

type Mode = "offer" | "accepted" | "clear";

/**
 * Accepting / declining an invite. Only the code goes to the server, which decides attribution at
 * sign-up based on the signed-in identity; the client submits no user ID and doesn't decide who
 * gets a reward. Refreshes the server-rendered page when the action completes.
 */
export function InviteActions({ code, mode }: { code: string; mode: Mode }) {
  const t = useTranslations("Referrals.invite");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  // Which invite was cleared: clearing an earlier context and declining this invite are different
  // things, and the copy has to say the right one.
  const [done, setDone] = useState<"declined" | "cleared" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: "accept" | "decline") {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/acquisition/referrals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          action === "accept" ? { action, code } : { action },
        ),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(
          response.status === 429
            ? t("rateLimited")
            : body?.error === "invalid"
              ? t("invalidTitle")
              : t("error"),
        );
        return;
      }
      if (action === "decline")
        setDone(mode === "clear" ? "cleared" : "declined");
      router.refresh();
    } catch {
      setError(t("error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {/* With an existing context this invite can't be accepted (the server keeps the first
            invite), so don't show a button that would fail silently. */}
        {mode === "offer" && (
          <Button
            type="button"
            size="marketing"
            disabled={pending}
            data-testid="referral-accept"
            onClick={() => submit("accept")}
          >
            {t("accept")}
          </Button>
        )}
        {!done && (
          <Button
            type="button"
            size="marketing"
            variant="outline"
            disabled={pending}
            data-testid="referral-decline"
            onClick={() => submit("decline")}
          >
            {mode === "offer" ? t("decline") : t("clear")}
          </Button>
        )}
      </div>
      {/* After clearing or declining, say what happened: the page goes back to the not-accepted
          state, and people shouldn't think the click did nothing. */}
      {done && (
        <p role="status" className="text-muted-foreground text-sm">
          {done === "cleared" ? t("cleared") : t("declined")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
