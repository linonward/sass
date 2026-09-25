"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect, useRef } from "react";

import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";

import {
  adjustCreditsAction,
  banUserAction,
  unbanUserAction,
  type AdminActionState,
} from "../actions";

const idle: AdminActionState = { status: "idle" };

function Status({
  state,
  success,
}: {
  state: AdminActionState;
  success?: string;
}) {
  const t = useTranslations("Admin");
  if (state.status === "error") {
    return (
      <p role="alert" className="text-destructive text-sm">
        {t(`errors.${state.error}`)}
      </p>
    );
  }
  if (state.status === "success" && success) {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {state.duplicate ? t("user.duplicate") : success}
      </p>
    );
  }
  return null;
}

/**
 * 调整积分。requestId 由服务端生成：第一次来自页面，之后每次成功由 action 返回新的，
 * 同一个 ID 重复提交只生效一次。
 */
export function AdjustCreditsForm({
  userId,
  requestId,
}: {
  userId: string;
  requestId: string;
}) {
  const t = useTranslations("Admin.user");
  const [state, action, pending] = useActionState(adjustCreditsAction, idle);
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="adjust-amount">{t("amount")}</Label>
          <Input
            id="adjust-amount"
            name="amount"
            type="number"
            step={1}
            required
            inputMode="numeric"
            aria-describedby="adjust-amount-hint"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="adjust-reason">{t("reason")}</Label>
          <Input
            id="adjust-reason"
            name="reason"
            required
            maxLength={500}
            placeholder={t("reasonPlaceholder")}
          />
        </div>
      </div>
      <p id="adjust-amount-hint" className="text-muted-foreground text-xs">
        {t("amountHint")}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {t("adjust")}
        </Button>
        <Status state={state} success={t("adjusted")} />
      </div>
    </form>
  );
}

/** 封禁（带可选原因）或解除封禁。 */
export function BanForm({
  userId,
  banned,
}: {
  userId: string;
  banned: boolean;
}) {
  const t = useTranslations("Admin.user");
  const [state, action, pending] = useActionState(
    banned ? unbanUserAction : banUserAction,
    idle,
  );

  return (
    <form
      action={action}
      aria-label={banned ? t("unban") : t("ban")}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="userId" value={userId} />
      {!banned && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ban-reason">{t("banReason")}</Label>
          <Input id="ban-reason" name="reason" maxLength={500} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant={banned ? "outline" : "destructive"}
          disabled={pending}
        >
          {banned ? t("unban") : t("ban")}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}
