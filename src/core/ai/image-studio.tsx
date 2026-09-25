"use client";

import { ImageIcon, Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Link } from "@/core/i18n/navigation";
import { Button, buttonVariants } from "@/core/ui/button";

import { imageErrorCode, type ImageErrorCode } from "./errors";
import { useGenerations } from "./generations-context";
import type { Generation } from "./image";

const aspectRatios = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;

/** 示例图片生成：选模型和画幅、输入提示词，同步出图；下方列出最近生成。 */
export function ImageStudio({
  models,
  defaultModel,
}: {
  models: { id: string; creditCost: number }[];
  defaultModel: string;
}) {
  const t = useTranslations("Playground.image");
  const tErrors = useTranslations("Playground.errors");
  const [modelId, setModelId] = useState(defaultModel);
  const [aspectRatio, setAspectRatio] =
    useState<(typeof aspectRatios)[number]>("1:1");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ImageErrorCode | null>(null);
  const { generations: all, addGeneration } = useGenerations();
  const generations = all.filter((g) => g.kind === "image");
  // 本次页面里刚生成的那张，在列表里高亮。
  const [latestId, setLatestId] = useState<string | null>(null);
  const modelSelectId = useId();
  const ratioSelectId = useId();
  const promptId = useId();
  const cost = models.find((m) => m.id === modelId)?.creditCost ?? 0;

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
        body: JSON.stringify({ prompt: text, modelId, aspectRatio }),
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
          <select
            id={modelSelectId}
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
            disabled={busy}
            className="border-input dark:bg-input/30 h-8 rounded-lg border bg-transparent px-2"
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.id}
              </option>
            ))}
          </select>
          <label htmlFor={ratioSelectId} className="font-medium">
            {t("aspectRatio")}
          </label>
          <select
            id={ratioSelectId}
            value={aspectRatio}
            onChange={(event) =>
              setAspectRatio(event.target.value as typeof aspectRatio)
            }
            disabled={busy}
            className="border-input dark:bg-input/30 h-8 rounded-lg border bg-transparent px-2"
          >
            {aspectRatios.map((ratio) => (
              <option key={ratio} value={ratio}>
                {ratio}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground">
            {cost > 0 ? t("cost", { cost }) : t("free")}
          </span>
        </div>
        <label htmlFor={promptId} className="sr-only">
          {t("placeholder")}
        </label>
        <textarea
          id={promptId}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={t("placeholder")}
          maxLength={2000}
          rows={3}
          disabled={busy}
          className="border-input dark:bg-input/30 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3"
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
                  {/* 生成的图片在 R2 上，尺寸不定；不走 next/image 的优化。 */}
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
