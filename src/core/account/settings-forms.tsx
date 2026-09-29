"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";

import { nativeName } from "@/core/i18n/locale-switcher";
import { Button } from "@/core/ui/button";
import { ConfirmActionDialog } from "@/core/ui/confirm-action-dialog";
import { Input } from "@/core/ui/input";
import { FormField } from "@/core/ui/form-field";
import { FormMessage } from "@/core/ui/form-message";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/select";
import { SubmitButton } from "@/core/ui/submit-button";

import {
  deleteAccount,
  updateLocale,
  updateName,
  type ActionState,
} from "./actions";

const idle: ActionState = { status: "idle" };

/** The saved / error line every settings form shows under itself. */
function useStatusMessage(state: ActionState) {
  const t = useTranslations("Account.status");
  return {
    error: state.status === "error" ? t(state.error) : undefined,
    success: state.status === "success" ? t("saved") : undefined,
  };
}

export function NameForm({ name }: { name: string }) {
  const t = useTranslations("Account.name");
  const locale = useLocale();
  const [state, action] = useActionState(updateName.bind(null, locale), idle);
  const message = useStatusMessage(state);

  return (
    <form
      action={action}
      aria-label={t("label")}
      className="flex flex-col gap-3"
    >
      <FormField label={t("label")}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            name="name"
            defaultValue={name}
            maxLength={80}
            required
            autoComplete="name"
            className="sm:max-w-sm"
          />
          <SubmitButton pendingLabel={t("saving")}>{t("save")}</SubmitButton>
        </div>
      </FormField>
      <FormMessage {...message} />
    </form>
  );
}

export function LocaleForm({
  locales,
  current,
}: {
  locales: readonly string[];
  current: string;
}) {
  const t = useTranslations("Account.locale");
  const locale = useLocale();
  const [state, action] = useActionState(updateLocale.bind(null, locale), idle);
  const message = useStatusMessage(state);

  return (
    <form
      action={action}
      aria-label={t("label")}
      className="flex flex-col gap-3"
    >
      <FormField label={t("label")} labelFor="button">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select
            name="locale"
            defaultValue={current}
            items={locales.map((l) => ({ value: l, label: nativeName(l) }))}
          >
            <SelectTrigger className="w-full sm:max-w-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {locales.map((l) => (
                <SelectItem key={l} value={l} lang={l}>
                  {nativeName(l)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SubmitButton pendingLabel={t("saving")}>{t("save")}</SubmitButton>
        </div>
      </FormField>
      <FormMessage {...message} />
    </form>
  );
}

export function DeleteAccount({ email }: { email: string }) {
  const t = useTranslations("Account.delete");
  const ts = useTranslations("Account.status");
  const locale = useLocale();

  // Success never comes back: the action clears the session and redirects home.
  return (
    <ConfirmActionDialog
      trigger={<Button variant="destructive">{t("open")}</Button>}
      title={t("title")}
      description={t("description")}
      tone="destructive"
      confirmText={{
        label: t.rich("confirmLabel", {
          email: () => <strong className="break-all">{email}</strong>,
        }),
        expected: email,
        inputMode: "email",
      }}
      confirmLabel={t("confirm")}
      pendingLabel={t("deleting")}
      cancelLabel={t("cancel")}
      action={(form) => deleteAccount(locale, idle, form)}
      errorMessage={(error) => ts(error)}
    />
  );
}
