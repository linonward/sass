"use client";

import { Loader2Icon, VideoIcon } from "lucide-react";
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

import { useGenerations } from "./generations-context";
import { imageErrorCode, type ImageErrorCode } from "./errors";
import { ImagePicker, type PickedImage } from "./image-picker";
import type { VideoJob } from "./video";
import { PromptTemplates, usePromptTemplate } from "./prompt-templates";

const aspectRatios = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;

type VideoModelOption = {
  id: string;
  creditCost: number;
  input: "text" | "image";
  duration: number;
};

/**
 * Example video generation: text-to-video or image-to-video (the first frame is a recently
 * generated image or an upload). After submitting, GenerationsProvider polls the job status; after
 * a page reload it keeps polling jobs that haven't finished.
 */
export function VideoStudio({
  models,
  defaultModel,
}: {
  models: VideoModelOption[];
  defaultModel: string;
}) {
  const t = useTranslations("Playground.video");
  const tErrors = useTranslations("Playground.errors");
  const [modelId, setModelId] = useState(defaultModel);
  const [aspectRatio, setAspectRatio] =
    useState<(typeof aspectRatios)[number]>("16:9");
  const [prompt, setPrompt] = useState("");
  const [frame, setFrame] = useState<PickedImage | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    generations,
    pendingVideos: pending,
    videoFailed,
    addPendingVideo,
    clearVideoFailed,
  } = useGenerations();
  const images = generations.filter((g) => g.kind === "image");
  // This page's own error wins; otherwise show a failed job found by polling (already refunded).
  const shownError = error ?? (videoFailed ? "video_failed" : null);
  const videos = generations.filter((g) => g.kind === "video");
  const modelSelectId = useId();
  const ratioSelectId = useId();
  const promptId = useId();
  const { ref: promptRef, apply: applyTemplate } =
    usePromptTemplate<HTMLTextAreaElement>(setPrompt);
  const model = models.find((m) => m.id === modelId) ?? models[0]!;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || submitting) return;
    if (model.input === "image" && !frame) {
      setError("invalid_image");
      return;
    }
    setSubmitting(true);
    setError(null);
    clearVideoFailed();
    try {
      const response = await fetch("/api/ai/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          modelId,
          aspectRatio,
          imageFileId: model.input === "image" ? frame?.fileId : undefined,
        }),
      });
      if (!response.ok) {
        setError(await imageErrorCode(response));
        return;
      }
      const { job } = (await response.json()) as { job: VideoJob };
      addPendingVideo({ id: job.id, prompt: text });
    } catch {
      setError("generic");
    } finally {
      setSubmitting(false);
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
            disabled={submitting}
            items={models.map((m) => ({
              value: m.id,
              label: `${m.id} · ${t(m.input === "image" ? "fromImage" : "fromText")}`,
            }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.id} · {t(m.input === "image" ? "fromImage" : "fromText")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {model.input === "text" && (
            <>
              <label htmlFor={ratioSelectId} className="font-medium">
                {t("aspectRatio")}
              </label>
              <Select
                id={ratioSelectId}
                value={aspectRatio}
                onValueChange={(value) => value && setAspectRatio(value)}
                disabled={submitting}
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
            </>
          )}
          <span className="text-muted-foreground">
            {t("summary", { duration: model.duration, cost: model.creditCost })}
          </span>
        </div>

        {model.input === "image" && (
          <ImagePicker
            legend={t("firstFrame")}
            images={images}
            value={frame}
            onChange={setFrame}
          />
        )}

        <PromptTemplates
          kind="video"
          onPick={applyTemplate}
          disabled={submitting}
        />
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
          disabled={submitting}
        />
        <div>
          <Button type="submit" disabled={submitting || !prompt.trim()}>
            {submitting ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : (
              <VideoIcon aria-hidden />
            )}
            {t("generate")}
          </Button>
        </div>
      </form>

      {shownError && (
        <p role="alert" className="text-destructive text-sm">
          {shownError === "video_failed"
            ? t(`errors.${shownError}`)
            : tErrors(shownError as ImageErrorCode)}{" "}
          {shownError === "insufficient_credits" && (
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
        {videos.length === 0 && pending.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        ) : (
          <ul
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="videos"
          >
            {pending.map((job) => (
              <li key={job.id} aria-busy="true">
                <div className="bg-muted text-muted-foreground flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg border text-sm">
                  <Loader2Icon className="size-5 animate-spin" aria-hidden />
                  {t("generating")}
                  <span className="text-xs">{t("wait")}</span>
                </div>
                <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                  {job.prompt}
                </p>
              </li>
            ))}
            {videos.map((video) => (
              <li key={video.id}>
                <video
                  src={video.url}
                  controls
                  playsInline
                  preload="metadata"
                  className="bg-muted aspect-video w-full rounded-lg border object-contain"
                />
                <p
                  className="text-muted-foreground mt-1 line-clamp-2 text-xs"
                  title={video.prompt}
                >
                  {video.prompt}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
