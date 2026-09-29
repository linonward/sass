"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";

import { subscribeAction, type SubscribeState } from "./actions";

const idle: SubscribeState = { status: "idle" };

/**
 * Subscribe form at the bottom of the status page: enter an email → get a confirmation email →
 * get notified of incident changes from then on.
 *
 * Submission has only two outcomes (success / invalid input); there is no "already subscribed"
 * outcome — see subscribeAction.
 */
export function SubscribeForm({ locale }: { locale: string }) {
  const t = useTranslations("Status.subscribe");
  const [state, action, pending] = useActionState(subscribeAction, idle);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="locale" value={locale} />
      {/* Honeypot: humans can't see this input; anything that fills it in is a script. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="hidden"
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="status-subscribe-email">{t("label")}</Label>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            id="status-subscribe-email"
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            placeholder={t("placeholder")}
            disabled={pending}
            className="sm:max-w-72"
          />
          <Button
            type="submit"
            size="marketing"
            tone="primary"
            disabled={pending}
          >
            {t("cta")}
          </Button>
        </div>
      </div>
      {state.status === "success" && (
        <p role="status" className="text-sm">
          {t("done")}
        </p>
      )}
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-sm">
          {t(`errors.${state.error}`)}
        </p>
      )}
    </form>
  );
}
