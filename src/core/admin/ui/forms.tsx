"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect, useRef } from "react";

import { FormField } from "@/core/ui/form-field";
import { FormMessage } from "@/core/ui/form-message";
import { Input } from "@/core/ui/input";
import { SubmitButton } from "@/core/ui/submit-button";

import {
  adjustCreditsAction,
  banUserAction,
  unbanUserAction,
  type AdminActionState,
} from "../actions";

const idle: AdminActionState = { status: "idle" };

/** The error / success line under an admin form. */
function useAdminMessage(state: AdminActionState, success?: string) {
  const t = useTranslations("Admin");
  return {
    error: state.status === "error" ? t(`errors.${state.error}`) : undefined,
    success:
      state.status === "success" && success
        ? state.duplicate
          ? t("user.duplicate")
          : success
        : undefined,
  };
}

/**
 * Adjust credits. requestId is generated server-side: the first comes from the page, and each
 * success returns a new one from the action; resubmitting the same ID takes effect only once.
 */
export function AdjustCreditsForm({
  userId,
  requestId,
}: {
  userId: string;
  requestId: string;
}) {
  const t = useTranslations("Admin.user");
  const [state, action] = useActionState(adjustCreditsAction, idle);
  const message = useAdminMessage(state, t("adjusted"));
  const form = useRef<HTMLFormElement>(null);
  const nextRequestId =
    state.status === "success" ? state.nextRequestId : undefined;

  useEffect(() => {
    if (nextRequestId) form.current?.reset();
  }, [nextRequestId]);

  return (
    <form
      ref={form}
      action={action}
      aria-label={t("adjust")}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="userId" value={userId} />
      <input
        type="hidden"
        name="requestId"
        value={nextRequestId ?? requestId}
      />
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <FormField label={t("amount")} description={t("amountHint")}>
          <Input
            name="amount"
            type="number"
            step={1}
            required
            inputMode="numeric"
          />
        </FormField>
        <FormField label={t("reason")}>
          <Input
            name="reason"
            required
            maxLength={500}
            placeholder={t("reasonPlaceholder")}
          />
        </FormField>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>{t("adjust")}</SubmitButton>
        <FormMessage {...message} />
      </div>
    </form>
  );
}

/** Ban (with an optional reason) or lift a ban. */
export function BanForm({
  userId,
  banned,
}: {
  userId: string;
  banned: boolean;
}) {
  const t = useTranslations("Admin.user");
  const [state, action] = useActionState(
    banned ? unbanUserAction : banUserAction,
    idle,
  );
  const message = useAdminMessage(state);

  return (
    <form
      action={action}
      aria-label={banned ? t("unban") : t("ban")}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="userId" value={userId} />
      {!banned && (
        <FormField label={t("banReason")}>
          <Input name="reason" maxLength={500} />
        </FormField>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant={banned ? "outline" : "destructive"}>
          {banned ? t("unban") : t("ban")}
        </SubmitButton>
        <FormMessage {...message} />
      </div>
    </form>
  );
}
