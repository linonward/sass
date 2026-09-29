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
 * 复制一次性明文。和邀请链接同一套退路：复制不了（无剪贴板权限、非安全上下文）
 * 就选中输入框并提示按键，不假装已经复制成功 —— 这段明文只出现这一次。
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

/** 「新建 key」入口。明文显示在同一个弹层里，关掉就没了。 */
export function CreateKeyDialog({ locale }: { locale: string }) {
  const t = useTranslations("ApiKeys.create");
  // 关一次换一个 key 重挂载：下次打开回到空白表单，也丢掉上一次的明文。
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

/** 撤销确认。撤销不可逆：明文已经不在库里，撤销后这把 key 永久失效。 */
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
