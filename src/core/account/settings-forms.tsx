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
import { Label } from "@/core/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/select";

import {
  deleteAccount,
  updateLocale,
  updateName,
  type ActionState,
} from "./actions";

const idle: ActionState = { status: "idle" };

function Status({ state }: { state: ActionState }) {
  const t = useTranslations("Account.status");
  if (state.status === "idle") return null;
  const error = state.status === "error";
  return (
    <p
      role={error ? "alert" : "status"}
      className={
        error ? "text-destructive text-sm" : "text-muted-foreground text-sm"
      }
    >
      {error ? t(state.error) : t("saved")}
    </p>
  );
}

export function NameForm({ name }: { name: string }) {
  const t = useTranslations("Account.name");
  const locale = useLocale();
  const [state, action, pending] = useActionState(
    updateName.bind(null, locale),
    idle,
  );

  return (
    <form
      action={action}
      aria-label={t("label")}
      className="flex flex-col gap-3"
    >
      <Label htmlFor="account-name">{t("label")}</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="account-name"
          name="name"
          defaultValue={name}
          maxLength={80}
          required
          autoComplete="name"
          className="sm:max-w-sm"
        />
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
      <Status state={state} />
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
  const [state, action, pending] = useActionState(
    updateLocale.bind(null, locale),
    idle,
  );

  return (
    <form
      action={action}
      aria-label={t("label")}
      className="flex flex-col gap-3"
    >
      <Label htmlFor="account-locale">{t("label")}</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select
          id="account-locale"
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
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
      <Status state={state} />
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
          <Status state={state} />
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
