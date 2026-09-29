"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { nativeName } from "@/core/i18n/locale-switcher";
import { Button } from "@/core/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/core/ui/dialog";
import { Input } from "@/core/ui/input";
import { FormField } from "@/core/ui/form-field";
import { FormMessage } from "@/core/ui/form-message";
import { Label } from "@/core/ui/label";
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
  const tc = useTranslations("Common");
  const locale = useLocale();
  const [confirm, setConfirm] = useState("");
  const [state, action, pending] = useActionState(
    deleteAccount.bind(null, locale),
    idle,
  );
  const message = useStatusMessage(state);
  const matches = confirm.trim().toLowerCase() === email.toLowerCase();

  return (
    <Dialog onOpenChange={(open) => !open && setConfirm("")}>
      <DialogTrigger render={<Button variant="destructive" />}>
        {t("open")}
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <form action={action} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="delete-confirm" className="block leading-relaxed">
              {t.rich("confirmLabel", {
                email: () => <strong className="break-all">{email}</strong>,
              })}
            </Label>
            <Input
              id="delete-confirm"
              name="confirm"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              inputMode="email"
            />
          </div>
          <FormMessage {...message} />
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t("cancel")}
            </DialogClose>
            <Button
              type="submit"
              variant="destructive"
              disabled={!matches || pending}
            >
              {pending ? t("deleting") : t("confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
