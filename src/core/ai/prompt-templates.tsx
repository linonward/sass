"use client";

import { useTranslations } from "next-intl";
import { useCallback, useRef } from "react";
import { flushSync } from "react-dom";

import { Button } from "@/core/ui/button";

/**
 * Prompt templates per Playground tab. Each id maps to `Playground.templates.<kind>.<id>.label` /
 * `.prompt` in `messages/*.json`; add or remove ids here and there together. Chat templates are
 * sentence openers the user finishes; image and video templates are complete prompts (subject,
 * light, lens, composition, style) that work as is and show what a detailed prompt looks like.
 */
export const PROMPT_TEMPLATES = {
  chat: ["summarize", "translate", "code", "email"],
  image: [
    "product",
    "portrait",
    "interior",
    "landscape",
    "illustration",
    "icon",
  ],
  video: ["product", "drone", "street", "craft"],
} as const;

export type PromptTemplateKind = keyof typeof PROMPT_TEMPLATES;

/** `<kind>.<id>` for every template, so the message keys below stay type-checked. */
type TemplateKey = {
  [K in PromptTemplateKind]: `${K}.${(typeof PROMPT_TEMPLATES)[K][number]}`;
}[PromptTemplateKind];

/**
 * Fills a prompt field from a template: sets the value, focuses the field and puts the caret at
 * the end. The value is committed synchronously so the caret can move right away; deferring it
 * lets the first keystroke land before the caret moves.
 */
export function usePromptTemplate<
  T extends HTMLInputElement | HTMLTextAreaElement,
>(setValue: (value: string) => void) {
  const ref = useRef<T>(null);
  const apply = useCallback(
    (prompt: string) => {
      flushSync(() => setValue(prompt));
      const field = ref.current;
      field?.focus();
      field?.setSelectionRange(prompt.length, prompt.length);
    },
    [setValue],
  );
  return { ref, apply };
}

/** A row of template chips. Picking one hands its prompt to `onPick`; nothing is sent. */
export function PromptTemplates({
  kind,
  onPick,
  disabled,
}: {
  kind: PromptTemplateKind;
  onPick: (prompt: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("Playground.templates");
  return (
    <div
      role="group"
      aria-label={t("label")}
      className="flex flex-wrap gap-2"
      data-testid={`prompt-templates-${kind}`}
    >
      {PROMPT_TEMPLATES[kind].map((id) => {
        const key = `${kind}.${id}` as TemplateKey;
        return (
          <Button
            key={id}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onPick(t(`${key}.prompt`))}
          >
            {t(`${key}.label`)}
          </Button>
        );
      })}
    </div>
  );
}
