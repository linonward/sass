"use client";

import { ImageIcon, Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Link } from "@/core/i18n/navigation";
import { Button, buttonVariants } from "@/core/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/select";
import { Textarea } from "@/core/ui/textarea";

import { imageErrorCode, type ImageErrorCode } from "./errors";
import { useGenerations } from "./generations-context";
import { ImagePicker, type PickedImage } from "./image-picker";
import type { Generation } from "./image";
import { PromptTemplates, usePromptTemplate } from "./prompt-templates";

const aspectRatios = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;

/**
 * Example image generation: pick a model and aspect ratio, enter a prompt, and get an image
 * synchronously; recent generations are listed below. Models with acceptsImage can also take a
 * reference image (a recent generation or an upload) to edit.
 */
export function ImageStudio({
  models,
  defaultModel,
}: {
  models: { id: string; creditCost: number; acceptsImage: boolean }[];
  defaultModel: string;
}) {
  const t = useTranslations("Playground.image");
  const tErrors = useTranslations("Playground.errors");
  const [modelId, setModelId] = useState(defaultModel);
  const [aspectRatio, setAspectRatio] =
    useState<(typeof aspectRatios)[number]>("1:1");
  const [prompt, setPrompt] = useState("");
  const [reference, setReference] = useState<PickedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ImageErrorCode | null>(null);
  const { generations: all, addGeneration } = useGenerations();
  const generations = all.filter((g) => g.kind === "image");
  // The image just generated on this page visit, highlighted in the list.
  const [latestId, setLatestId] = useState<string | null>(null);
  const modelSelectId = useId();
  const ratioSelectId = useId();
  const promptId = useId();
  const { ref: promptRef, apply: applyTemplate } =
    usePromptTemplate<HTMLTextAreaElement>(setPrompt);
  const model = models.find((m) => m.id === modelId);
  const cost = model?.creditCost ?? 0;
  // Only sent when the selected model takes one; switching models keeps the pick for later.
  const imageFileId = model?.acceptsImage ? reference?.fileId : undefined;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          modelId,
          aspectRatio,
          imageFileId,
        }),
      });
      if (!response.ok) {
        setError(await imageErrorCode(response));
        return;
      }
      const { generation } = (await response.json()) as {
        generation: Generation;
      };
      addGeneration(generation);
      setLatestId(generation.id);
    } catch {
      setError("generic");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label htmlFor={modelSelectId} className="font-medium">
            {t("model")}
          </label>
          <Select
            id={modelSelectId}
            value={modelId}
            onValueChange={(value) => value && setModelId(value)}
            disabled={busy}
            items={models.map((model) => ({
              value: model.id,
              label: model.id,
            }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {models.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label htmlFor={ratioSelectId} className="font-medium">
            {t("aspectRatio")}
          </label>
          <Select
            id={ratioSelectId}
            value={aspectRatio}
            onValueChange={(value) => value && setAspectRatio(value)}
            disabled={busy}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {aspectRatios.map((ratio) => (
                <SelectItem key={ratio} value={ratio}>
                  {ratio}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground">
            {cost > 0 ? t("cost", { cost }) : t("free")}
          </span>
        </div>
        {model?.acceptsImage && (
          <div className="space-y-1">
            <ImagePicker
              legend={t("reference")}
              images={generations}
              value={reference}
              onChange={setReference}
              disabled={busy}
              removable
            />
            <p className="text-muted-foreground text-xs">
              {t("referenceHint")}
            </p>
          </div>
        )}
        <PromptTemplates kind="image" onPick={applyTemplate} disabled={busy} />
        <label htmlFor={promptId} className="sr-only">
          {t("placeholder")}
        </label>
        <Textarea
          ref={promptRef}
          id={promptId}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={t("placeholder")}
          maxLength={2000}
          rows={3}
          disabled={busy}
        />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy || !prompt.trim()}>
            {busy ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : (
              <ImageIcon aria-hidden />
            )}
            {busy ? t("generating") : t("generate")}
          </Button>
          {busy && (
            <span className="text-muted-foreground text-sm">{t("wait")}</span>
          )}
        </div>
      </form>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {tErrors(error)}{" "}
          {error === "insufficient_credits" && (
            <Link
              href="/pricing"
              className={buttonVariants({ variant: "link", size: "sm" })}
            >
              {t("buyCredits")}
            </Link>
          )}
        </p>
      )}

      <section aria-labelledby={`${promptId}-recent`} className="space-y-3">
        <h2 id={`${promptId}-recent`} className="text-sm font-medium">
          {t("recent")}
        </h2>
        {generations.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        ) : (
          <ul
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
            data-testid="generations"
          >
            {generations.map((generation) => (
              <li
                key={generation.id}
                className={
                  generation.id === latestId
                    ? "ring-primary/40 rounded-lg ring-2"
                    : undefined
                }
              >
                <a
                  href={generation.url}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-muted block overflow-hidden rounded-lg border"
                >
                  {/* Generated images live on R2 at arbitrary sizes; skip next/image optimization. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={generation.url}
                    alt={generation.prompt}
                    loading="lazy"
                    className="aspect-square w-full object-cover"
                  />
                </a>
                <p
                  className="text-muted-foreground mt-1 line-clamp-2 text-xs"
                  title={generation.prompt}
                >
                  {generation.prompt}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
