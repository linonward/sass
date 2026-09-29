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

// Videos usually finish in 1–5 minutes.
export const POLL_INTERVAL_MS = 5000;

export type PendingVideo = { id: string; prompt: string };

type GenerationsContextValue = {
  generations: Generation[];
  pendingVideos: PendingVideo[];
  // True when a video generation failed (and was refunded); the video page shows a notice for it.
  videoFailed: boolean;
  addGeneration: (generation: Generation) => void;
  addPendingVideo: (video: PendingVideo) => void;
  clearVideoFailed: () => void;
};

const GenerationsContext = createContext<GenerationsContextValue | null>(null);

/**
 * Generation records shared by the image and video pages. The initial data is queried by the server
 * page and passed in (queried only once), so a newly generated image can immediately be picked as a
 * first frame on the video page.
 *
 * Videos still being generated are polled here: each round waits for all requests to return before
 * scheduling the next, so the same job is never queried twice at once (on completion the server
 * downloads the video and writes it to R2, which can take longer than the poll interval). Every
 * query advances state on the server.
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
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;

    async function poll(id: string) {
      if (inFlight.current.has(id)) return;
      inFlight.current.add(id);
      try {
        const response = await fetch(`/api/ai/video/${id}`, {
          signal: controller.signal,
          // Every round advances server state, so nothing may be cached (the route also sets
          // no-store).
          cache: "no-store",
        });
        if (response.ok)
          settle(((await response.json()) as { job: VideoJob }).job);
      } catch {
        // On a network error, retry next round; an abort on leaving the page also lands here.
      } finally {
        inFlight.current.delete(id);
      }
    }

    async function tick() {
      await Promise.all(pendingIds.split(",").map(poll));
      if (!controller.signal.aborted)
        timer = setTimeout(tick, POLL_INTERVAL_MS);
    }

    timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      controller.abort();
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
