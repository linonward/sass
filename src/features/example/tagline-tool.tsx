"use client";

import { Sparkles, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";

import { generateTaglines, type TaglineState } from "./actions";

const idle: TaglineState = { status: "idle" };

export function TaglineTool({
  requestId,
  quickCost,
  aiCost,
}: {
  /** 第一次提交用的请求 ID，由服务端生成；之后用 action 返回的新 ID。 */
  requestId: string;
  quickCost: number;
  /** AI 生成每次的积分成本；AI 未开启时为 null，不显示 AI 按钮。 */
  aiCost: number | null;
}) {
  const t = useTranslations("Example");
  const [state, action, pending] = useActionState(generateTaglines, idle);

  return (
    <div className="flex flex-col gap-6">
      <form action={action} className="flex flex-col gap-3">
        <input
          type="hidden"
          name="requestId"
          value={state.status === "done" ? state.nextRequestId : requestId}
        />
        <Label htmlFor="example-product">{t("productLabel")}</Label>
        <Input
          id="example-product"
          name="product"
          required
          minLength={3}
          maxLength={200}
          defaultValue={state.status === "done" ? state.product : undefined}
          placeholder={t("productPlaceholder")}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" name="mode" value="quick" disabled={pending}>
            <Zap />
            {t("quick", { cost: quickCost })}
          </Button>
          {aiCost !== null && (
            <Button
              type="submit"
              name="mode"
              value="ai"
              variant="outline"
              disabled={pending}
            >
              <Sparkles />
              {t("ai", { cost: aiCost })}
            </Button>
          )}
        </div>
      </form>

      {state.status === "done" &&
        (state.ok ? (
          <ul
            aria-label={t("results")}
            className="divide-y rounded-lg border text-sm"
          >
            {state.taglines.map((line) => (
              <li key={line} className="px-4 py-3">
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <p role="alert" className="text-destructive text-sm">
            {t(`errors.${state.error}`)}
          </p>
        ))}
    </div>
  );
}
