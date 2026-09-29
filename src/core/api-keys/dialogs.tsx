"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { Button } from "@/core/ui/button";
import { ConfirmActionDialog } from "@/core/ui/confirm-action-dialog";
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
  createApiKey,
  revokeApiKey,
  type CreateKeyState,
  type RevokeKeyState,
} from "./actions";
import { API_KEY_NAME_MAX } from "./name";

const idleCreate: CreateKeyState = { status: "idle" };
const idleRevoke: RevokeKeyState = { status: "idle" };

/**
 * Copies the one-time plaintext. Same fallback as the referral link: if copying fails (no clipboard
 * permission, insecure context), select the input and show a keyboard hint instead of pretending it
 * was copied — this plaintext is only shown once.
 */
function CopyPlaintext({ value }: { value: string }) {
  const t = useTranslations("ApiKeys.create");
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      const field = document.getElementById("api-key-created-value");
      if (field instanceof HTMLInputElement) field.select();
      setState("manual");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="api-key-created-value"
          data-testid="api-key-created-value"
          readOnly
          value={value}
          className="font-mono text-xs"
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          type="button"
          variant="outline"
          className="sm:w-28"
          data-testid="api-key-copy"
          data-state={state}
          onClick={copy}
        >
          {state === "copied" ? t("copied") : t("copy")}
        </Button>
      </div>
      {state === "manual" && (
        <p className="text-muted-foreground text-sm">{t("copyManual")}</p>
      )}
    </div>
  );
}

function CreateKeyForm({ locale }: { locale: string }) {
  const t = useTranslations("ApiKeys.create");
  const tc = useTranslations("Common");
  const [state, action, pending] = useActionState(
    createApiKey.bind(null, locale),
    idleCreate,
  );

  if (state.status === "created") {
    return (
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("createdTitle")}</DialogTitle>
          <DialogDescription>{t("createdDescription")}</DialogDescription>
        </DialogHeader>
        <CopyPlaintext value={state.plaintext} />
        <p data-testid="api-key-created-name" className="text-sm">
          {t("createdName", { name: state.name })}
        </p>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t("done")}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent closeLabel={tc("close")}>
      <form action={action} className="flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="api-key-name">{t("nameLabel")}</Label>
          <Input
            id="api-key-name"
            name="name"
            data-testid="api-key-name"
            required
            maxLength={API_KEY_NAME_MAX}
            autoComplete="off"
            spellCheck={false}
            placeholder={t("namePlaceholder")}
          />
          <p className="text-muted-foreground text-xs">{t("nameHint")}</p>
        </div>
        {state.status === "error" && (
          <p role="alert" className="text-destructive text-sm">
            {t(`errors.${state.error}`)}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>
            {t("cancel")}
          </DialogClose>
          <Button type="submit" disabled={pending}>
            {pending ? t("creating") : t("submit")}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/**
 * The "create key" entry point. The plaintext shows in the same dialog and is gone once it closes.
 */
export function CreateKeyDialog({ locale }: { locale: string }) {
  const t = useTranslations("ApiKeys.create");
  // Each close changes the React key and remounts: the next open starts with a blank form and drops
  // the previous plaintext.
  const [session, setSession] = useState(0);

  return (
    <Dialog
      key={session}
      onOpenChange={(open) => !open && setSession((count) => count + 1)}
    >
      <DialogTrigger
        render={
          <Button data-testid="api-key-create" className="max-sm:w-full" />
        }
      >
        {t("open")}
      </DialogTrigger>
      <CreateKeyForm locale={locale} />
    </Dialog>
  );
}

/**
 * Revoke confirmation. Revoking is irreversible: the plaintext isn't in the database, so a revoked
 * key is dead for good.
 */
export function RevokeKeyDialog({
  locale,
  keyId,
  name,
}: {
  locale: string;
  keyId: string;
  name: string;
}) {
  const t = useTranslations("ApiKeys.revoke");

  return (
    <ConfirmActionDialog
      trigger={
        <Button variant="outline" size="sm" data-testid="api-key-revoke">
          {t("open")}
        </Button>
      }
      title={t("title", { name })}
      description={t("description")}
      tone="destructive"
      fields={{ keyId }}
      confirmLabel={t("confirm")}
      pendingLabel={t("revoking")}
      cancelLabel={t("cancel")}
      confirmTestId="api-key-revoke-confirm"
      action={(form) => revokeApiKey(locale, idleRevoke, form)}
      errorMessage={(error) => t(`errors.${error}`)}
    />
  );
}
