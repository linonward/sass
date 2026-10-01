import { describe, expect, test } from "vitest";

import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { PROMPT_TEMPLATES, type PromptTemplateKind } from "./prompt-templates";

// The id lists live in code and the copy in messages; a template added to one side only would
// render a raw key. Prompts must also fit the 2,000-character limit of the image/video fields.
describe("PROMPT_TEMPLATES", () => {
  for (const [locale, messages] of [
    ["en", en],
    ["zh", zh],
  ] as const) {
    test(`every template has a label and prompt in ${locale}`, () => {
      const templates = messages.Playground.templates as unknown as Record<
        PromptTemplateKind,
        Record<string, { label?: string; prompt?: string }>
      >;
      for (const kind of Object.keys(
        PROMPT_TEMPLATES,
      ) as PromptTemplateKind[]) {
        expect(Object.keys(templates[kind]).sort()).toEqual(
          [...PROMPT_TEMPLATES[kind]].sort(),
        );
        for (const id of PROMPT_TEMPLATES[kind]) {
          const { label, prompt } = templates[kind][id] ?? {};
          expect(label, `${kind}.${id}.label`).toBeTruthy();
          expect(prompt, `${kind}.${id}.prompt`).toBeTruthy();
          expect(prompt!.length).toBeLessThanOrEqual(2000);
        }
      }
    });
  }
});
