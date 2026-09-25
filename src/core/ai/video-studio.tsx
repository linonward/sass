"use client";

import { CheckIcon, Loader2Icon, UploadIcon, VideoIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Link } from "@/core/i18n/navigation";
import { cn } from "@/core/lib/utils";
import { Button, buttonVariants } from "@/core/ui/button";
import { uploadFile } from "@/core/upload/client";

import type { Generation } from "./image";
import { imageErrorCode, type ImageErrorCode } from "./image-studio";
import type { VideoJob } from "./video";

const aspectRatios = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;
// 视频通常 1–5 分钟完成。
const POLL_INTERVAL_MS = 5000;

type VideoModelOption = {
  id: string;
  creditCost: number;
  input: "text" | "image";
  duration: number;
};
type PendingVideo = { id: string; prompt: string };
type FirstFrame = { fileId: string; url: string };

/**
 * 示例视频生成：文生视频或图生视频（首帧选最近生成的图片，或上传一张）。
 * 提交后轮询任务状态；刷新页面后会继续轮询还没完成的任务。
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
  const [frame, setFrame] = useState<FirstFrame | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<Generation[]>([]);
  const [videos, setVideos] = useState<Generation[] | null>(null);
  const [pending, setPending] = useState<PendingVideo[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const modelSelectId = useId();
  const ratioSelectId = useId();
  const promptId = useId();
  const model = models.find((m) => m.id === modelId) ?? models[0]!;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/generations")
      .then((res) => (res.ok ? res.json() : {}))
      .then(
        (body: {
          generations?: Generation[];
          pendingVideos?: PendingVideo[];
        }) => {
          if (cancelled) return;
          const all = body.generations ?? [];
          setImages(all.filter((g) => g.kind === "image"));
          setVideos(all.filter((g) => g.kind === "video"));
          setPending(body.pendingVideos ?? []);
        },
      )
      .catch(() => {
        if (!cancelled) setVideos([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const settle = useCallback((job: VideoJob) => {
    if (job.status === "pending") return;
    setPending((list) => list.filter((p) => p.id !== job.id));
    if (job.status === "succeeded") {
      setVideos((list) => [job.generation, ...(list ?? [])]);
    } else {
      setError("video_failed");
    }
  }, []);

  // 轮询还在生成的任务；每次查询都会在服务端推进状态（完成时转存，失败时退款）。
  const pendingIds = pending.map((p) => p.id).join(",");
  useEffect(() => {
    if (!pendingIds) return;
    const timer = setInterval(() => {
      for (const id of pendingIds.split(",")) {
        fetch(`/api/ai/video/${id}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((body: { job: VideoJob } | null) => body && settle(body.job))
          .catch(() => {
            // 网络错误下次再查。
          });
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [pendingIds, settle]);

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded = await uploadFile(file);
      setFrame({ fileId: uploaded.id, url: uploaded.url });
    } catch {
      setError("upload_failed");
    } finally {
      setUploading(false);
    }
  }

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
      setPending((list) => [{ id: job.id, prompt: text }, ...list]);
    } catch {
      setError("generic");
    } finally {
      setSubmitting(false);
    }
  }

  const selectClass =
    "border-input dark:bg-input/30 h-8 rounded-lg border bg-transparent px-2";

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
            disabled={submitting}
            className={selectClass}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id} · {t(m.input === "image" ? "fromImage" : "fromText")}
              </option>
            ))}
          </select>
          {model.input === "text" && (
            <>
              <label htmlFor={ratioSelectId} className="font-medium">
                {t("aspectRatio")}
              </label>
              <select
                id={ratioSelectId}
                value={aspectRatio}
                onChange={(event) =>
                  setAspectRatio(event.target.value as typeof aspectRatio)
                }
                disabled={submitting}
                className={selectClass}
              >
                {aspectRatios.map((ratio) => (
                  <option key={ratio} value={ratio}>
                    {ratio}
                  </option>
                ))}
              </select>
            </>
          )}
          <span className="text-muted-foreground">
            {t("summary", { duration: model.duration, cost: model.creditCost })}
          </span>
        </div>

        {model.input === "image" && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("firstFrame")}</legend>
            <div className="flex flex-wrap gap-2">
              {images.slice(0, 8).map((image) => {
                const selected = frame?.fileId === image.fileId;
                return (
                  <button
                    key={image.id}
                    type="button"
                    onClick={() =>
                      setFrame({ fileId: image.fileId, url: image.url })
                    }
                    aria-pressed={selected}
                    aria-label={t("useImage", { prompt: image.prompt })}
                    className={cn(
                      "relative size-16 overflow-hidden rounded-md border",
                      selected && "ring-primary ring-2",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.url}
                      alt=""
                      className="size-full object-cover"
                    />
                    {selected && (
                      <CheckIcon
                        className="bg-primary text-primary-foreground absolute top-1 right-1 size-4 rounded-full p-0.5"
                        aria-hidden
                      />
                    )}
                  </button>
                );
              })}
              {frame && !images.some((i) => i.fileId === frame.fileId) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={frame.url}
                  alt={t("uploaded")}
                  className="ring-primary size-16 rounded-md border object-cover ring-2"
                />
              )}
              <Button
                type="button"
                variant="outline"
                className="size-16 flex-col gap-1 text-xs"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2Icon className="animate-spin" aria-hidden />
                ) : (
                  <UploadIcon aria-hidden />
                )}
                {t("upload")}
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={upload}
              />
            </div>
          </fieldset>
        )}

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
          disabled={submitting}
          className="border-input dark:bg-input/30 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3"
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

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error === "video_failed" || error === "upload_failed"
            ? t(`errors.${error}`)
            : tErrors(error as ImageErrorCode)}{" "}
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
        {videos === null ? (
          <Loader2Icon
            className="text-muted-foreground size-4 animate-spin"
            aria-label={t("loading")}
          />
        ) : videos.length === 0 && pending.length === 0 ? (
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
