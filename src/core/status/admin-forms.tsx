"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { StatusEventStatus } from "@/core/db/schema/status";
import { FormField } from "@/core/ui/form-field";
import { FormMessage } from "@/core/ui/form-message";
import { Input } from "@/core/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/select";
import { SubmitButton } from "@/core/ui/submit-button";
import { Textarea } from "@/core/ui/textarea";

import {
  createIncidentAction,
  resolveIncidentAction,
  updateIncidentAction,
  type StatusActionState,
} from "./actions";

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
  id?: string;
  /** 表单里没有可见 label 时（如行内的更新表单）给一个可访问名。 */
  ariaLabel?: string;
}) {
  const t = useTranslations("Status");
  return (
    <Select
      id={id}
      name={name}
      defaultValue={defaultValue}
      items={levels.map((level) => ({
        value: level,
        label: t(`statusLabel.${level}`),
      }))}
    >
      <SelectTrigger aria-label={ariaLabel} className="min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {levels.map((level) => (
          <SelectItem key={level} value={level}>
            {t(`statusLabel.${level}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The error / success line under a status-page form. */
function useFeedback(state: StatusActionState, success: string) {
  const t = useTranslations("Admin.statusPage");
  return {
    error: state.status === "error" ? t(`errors.${state.error}`) : undefined,
    success: state.status === "success" ? success : undefined,
  };
}

/** 开一条 incident。`operational` 是「没有影响的公告」，用来先发个通知。 */
export function CreateIncidentForm({
  components,
}: {
  components: { key: string; label: string }[];
}) {
  const t = useTranslations("Admin.statusPage");
  const [state, action] = useActionState(createIncidentAction, idle);
  const feedback = useFeedback(state, t("create.created"));
  const first = components[0]?.key ?? "";

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr]">
        <FormField label={t("create.component")} labelFor="button">
          <Select
            name="component"
            defaultValue={first}
            items={components.map((component) => ({
              value: component.key,
              label: component.label,
            }))}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {components.map((component) => (
                <SelectItem key={component.key} value={component.key}>
                  {component.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label={t("create.status")} labelFor="button">
          <LevelSelect name="status" defaultValue="degraded" />
        </FormField>
      </div>
      <FormField label={t("create.message")}>
        <Textarea
          name="message"
          required
          maxLength={500}
          rows={3}
          placeholder={t("create.messagePlaceholder")}
        />
      </FormField>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>{t("create.submit")}</SubmitButton>
        <FormMessage {...feedback} />
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
  const [updateState, update] = useActionState(updateIncidentAction, idle);
  const [resolveState, resolve] = useActionState(resolveIncidentAction, idle);
  const updated = useFeedback(updateState, t("open.updated"));
  const resolved = useFeedback(resolveState, t("open.resolved"));

  return (
    <div className="flex flex-col gap-3">
      <form
        action={update}
        aria-label={t("open.update")}
        className="flex flex-wrap items-end gap-2"
      >
        <input type="hidden" name="id" value={incident.id} />
        <LevelSelect
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
        <SubmitButton size="sm" variant="outline">
          {t("open.update")}
        </SubmitButton>
      </form>
      <form
        action={resolve}
        aria-label={t("open.resolve")}
        className="flex flex-wrap items-center gap-3"
      >
        <input type="hidden" name="id" value={incident.id} />
        <SubmitButton size="sm" variant="secondary">
          {t("open.resolve")}
        </SubmitButton>
        <FormMessage {...updated} />
        <FormMessage {...resolved} />
      </form>
    </div>
  );
}
