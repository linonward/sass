"use client";

import { Sparkles, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

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
  /** Request ID for the first submit, generated on the server; later submits use the new ID the action returns. */
  requestId: string;
  quickCost: number;
  /** Credit cost per AI generation; null when AI is off, in which case the AI button is hidden. */
  aiCost: number | null;
}) {
  const t = useTranslations("Example");
  const [state, action, pending] = useActionState(generateTaglines, idle);
  // Controlled input. After the action returns React resets the form, and uncontrolled inputs are
  // what gets reset — keeping their pre-submit content would rely on `defaultValue` happening to
  // catch that reset, which reads like dead code. Controlled values aren't affected by the reset,
  // so "tweak product after submitting and generate again" just works.
  const [product, setProduct] = useState("");

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
          value={product}
          onChange={(event) => setProduct(event.target.value)}
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
            {state.taglines.map((line, index) => (
              // Generated output can repeat (especially from AI), so include the position to make the key unique.
              <li key={`${index}-${line}`} className="px-4 py-3">
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
