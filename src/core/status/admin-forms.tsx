"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { StatusEventStatus } from "@/core/db/schema/status";
import { cn } from "@/core/lib/utils";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { Textarea } from "@/core/ui/textarea";

import {
  createIncidentAction,
  resolveIncidentAction,
  updateIncidentAction,
  type StatusActionState,
} from "./actions";

/**
 * 原生 select 的外观照 `Input`，产品语域用同一条发丝边。
 * （`acquisition/report-filters.tsx` 有一份同样的串；两处都必须是字面量，
 * Tailwind 扫源码文本才生成得出这些 class。）
 */
const selectClass = cn(
  "border-border focus-visible:border-ring focus-visible:ring-ring/50 h-8 min-w-36 rounded-lg border bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50",
);

const idle: StatusActionState = { status: "idle" };

const levels: readonly StatusEventStatus[] = [
  "operational",
  "degraded",
  "outage",
];

/** 影响级别的下拉。文案和状态页上的徽章共用一处（`Status.statusLabel`）。 */
function LevelSelect({
  name,
  defaultValue,
  id,
  ariaLabel,
}: {
  name: string;
  defaultValue: StatusEventStatus;
  id: string;
  /** 表单里没有可见 label 时（如行内的更新表单）给一个可访问名。 */
  ariaLabel?: string;
}) {
  const t = useTranslations("Status");
  return (
    <select
      id={id}
      name={name}
      defaultValue={defaultValue}
      aria-label={ariaLabel}
      className={selectClass}
    >
      {levels.map((level) => (
        <option key={level} value={level}>
          {t(`statusLabel.${level}`)}
        </option>
      ))}
    </select>
  );
}

function Feedback({
  state,
  success,
}: {
  state: StatusActionState;
  success: string;
}) {
  const t = useTranslations("Admin.statusPage");
  if (state.status === "error") {
    return (
      <p role="alert" className="text-destructive text-sm">
        {t(`errors.${state.error}`)}
      </p>
    );
  }
  if (state.status === "success") {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {success}
      </p>
    );
  }
  return null;
}

/** 开一条 incident。`operational` 是「没有影响的公告」，用来先发个通知。 */
export function CreateIncidentForm({
  components,
}: {
  components: { key: string; label: string }[];
}) {
  const t = useTranslations("Admin.statusPage");
  const [state, action, pending] = useActionState(createIncidentAction, idle);
  const first = components[0]?.key ?? "";

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="incident-component">{t("create.component")}</Label>
          <select
            id="incident-component"
            name="component"
            defaultValue={first}
            className={selectClass}
          >
            {components.map((component) => (
              <option key={component.key} value={component.key}>
                {component.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="incident-status">{t("create.status")}</Label>
          <LevelSelect
            id="incident-status"
            name="status"
            defaultValue="degraded"
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="incident-message">{t("create.message")}</Label>
        <Textarea
          id="incident-message"
          name="message"
          required
          maxLength={500}
          rows={3}
          placeholder={t("create.messagePlaceholder")}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {t("create.submit")}
        </Button>
        <Feedback state={state} success={t("create.created")} />
      </div>
    </form>
  );
}

/** 进行中的 incident：改影响级别和说明，或者标记恢复。 */
export function IncidentActions({
  incident,
}: {
  incident: { id: string; status: StatusEventStatus; message: string };
}) {
  const t = useTranslations("Admin.statusPage");
  const [updateState, update, updating] = useActionState(
    updateIncidentAction,
    idle,
  );
  const [resolveState, resolve, resolving] = useActionState(
    resolveIncidentAction,
    idle,
  );

  return (
    <div className="flex flex-col gap-3">
      <form
        action={update}
        aria-label={t("open.update")}
        className="flex flex-wrap items-end gap-2"
      >
        <input type="hidden" name="id" value={incident.id} />
        <LevelSelect
          id={`incident-${incident.id}-status`}
          name="status"
          defaultValue={incident.status}
          ariaLabel={t("open.status")}
        />
        <Input
          name="message"
          defaultValue={incident.message}
          required
          maxLength={500}
          aria-label={t("open.message")}
          className="sm:max-w-96"
        />
        <Button type="submit" size="sm" variant="outline" disabled={updating}>
          {t("open.update")}
        </Button>
      </form>
      <form
        action={resolve}
        aria-label={t("open.resolve")}
        className="flex flex-wrap items-center gap-3"
      >
        <input type="hidden" name="id" value={incident.id} />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          disabled={resolving}
        >
          {t("open.resolve")}
        </Button>
        <Feedback state={updateState} success={t("open.updated")} />
        <Feedback state={resolveState} success={t("open.resolved")} />
      </form>
    </div>
  );
}
