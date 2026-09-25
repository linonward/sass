"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { Generation } from "./image";
import type { VideoJob } from "./video";

// 视频通常 1–5 分钟完成。
export const POLL_INTERVAL_MS = 5000;

export type PendingVideo = { id: string; prompt: string };

type GenerationsContextValue = {
  generations: Generation[];
  pendingVideos: PendingVideo[];
  // 有视频生成失败（已退款）时为 true，视频页据此提示。
  videoFailed: boolean;
  addGeneration: (generation: Generation) => void;
  addPendingVideo: (video: PendingVideo) => void;
  clearVideoFailed: () => void;
};

const GenerationsContext = createContext<GenerationsContextValue | null>(null);

/**
 * 图片页和视频页共用的生成记录。初始数据由服务端页面查好传入（只查一次），
 * 新生成的图片马上能在视频页选作首帧。
 *
 * 还在生成的视频在这里轮询：每轮等所有请求返回后再排下一轮，同一个任务不会同时查两次
 * （完成时服务端要下载视频并写 R2，可能超过轮询间隔）。每次查询都会在服务端推进状态。
 */
export function GenerationsProvider({
  initialGenerations,
  initialPendingVideos,
  children,
}: {
  initialGenerations: Generation[];
  initialPendingVideos: PendingVideo[];
  children: ReactNode;
}) {
  const [generations, setGenerations] = useState(initialGenerations);
  const [pendingVideos, setPendingVideos] = useState(initialPendingVideos);
  const [videoFailed, setVideoFailed] = useState(false);
  const inFlight = useRef(new Set<string>());

  const addGeneration = useCallback((generation: Generation) => {
    setGenerations((list) =>
      list.some((g) => g.id === generation.id) ? list : [generation, ...list],
    );
  }, []);

  const addPendingVideo = useCallback((video: PendingVideo) => {
    setPendingVideos((list) =>
      list.some((v) => v.id === video.id) ? list : [video, ...list],
    );
  }, []);

  const settle = useCallback(
    (job: VideoJob) => {
      if (job.status === "pending") return;
      setPendingVideos((list) => list.filter((v) => v.id !== job.id));
      if (job.status === "succeeded") addGeneration(job.generation);
      else setVideoFailed(true);
    },
    [addGeneration],
  );

  const pendingIds = pendingVideos.map((v) => v.id).join(",");
  useEffect(() => {
    if (!pendingIds) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll(id: string) {
      if (inFlight.current.has(id)) return;
      inFlight.current.add(id);
      try {
        const response = await fetch(`/api/ai/video/${id}`);
        if (response.ok)
          settle(((await response.json()) as { job: VideoJob }).job);
      } catch {
        // 网络错误下一轮再查。
      } finally {
        inFlight.current.delete(id);
      }
    }

    async function tick() {
      await Promise.all(pendingIds.split(",").map(poll));
      if (!stopped) timer = setTimeout(tick, POLL_INTERVAL_MS);
    }

    timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [pendingIds, settle]);

  const value = useMemo(
    () => ({
      generations,
      pendingVideos,
      videoFailed,
      addGeneration,
      addPendingVideo,
      clearVideoFailed: () => setVideoFailed(false),
    }),
    [generations, pendingVideos, videoFailed, addGeneration, addPendingVideo],
  );

  return (
    <GenerationsContext.Provider value={value}>
      {children}
    </GenerationsContext.Provider>
  );
}

export function useGenerations() {
  const value = useContext(GenerationsContext);
  if (!value) {
    throw new Error("useGenerations must be used inside <GenerationsProvider>");
  }
  return value;
}
