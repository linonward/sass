import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  GenerationsProvider,
  POLL_INTERVAL_MS,
  useGenerations,
} from "./generations-context";
import type { Generation } from "./image";

const video: Generation = {
  id: "v1",
  kind: "video",
  fileId: "f1",
  modelId: "wan-t2v",
  prompt: "waves",
  url: "https://files.test/v1.mp4",
  mime: "video/mp4",
  createdAt: "2026-09-26T00:00:00.000Z",
};

function Probe() {
  const { generations, pendingVideos, videoFailed } = useGenerations();
  return (
    <p data-testid="state">
      {JSON.stringify({
        generations: generations.map((g) => g.id),
        pending: pendingVideos.map((v) => v.id),
        videoFailed,
      })}
    </p>
  );
}

const state = () => JSON.parse(screen.getByTestId("state").textContent!);

function renderWithPending() {
  return render(
    <GenerationsProvider
      initialGenerations={[]}
      initialPendingVideos={[{ id: "v1", prompt: "waves" }]}
    >
      <Probe />
    </GenerationsProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("GenerationsProvider polling", () => {
  test("does not re-query while the previous query is outstanding; adds the result only once when done", async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal("fetch", fetch);
    renderWithPending();

    // The first query never returns (the server is copying the video to storage), and no new one is
    // sent even after several poll intervals.
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4));
    expect(fetch).toHaveBeenCalledTimes(1);
    // Every round advances server state, so neither side may cache (compare /api/billing/status).
    expect(fetch).toHaveBeenCalledWith(
      "/api/ai/video/v1",
      expect.objectContaining({ cache: "no-store" }),
    );

    await act(async () => {
      resolve(
        Response.json({
          job: { id: "v1", status: "succeeded", generation: video },
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(state()).toEqual({
      generations: ["v1"],
      pending: [],
      videoFailed: false,
    });

    // Polling stops once no jobs are pending.
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("keeps polling on the interval while generating; sets videoFailed on failure", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ job: { id: "v1", status: "pending" } }),
      )
      .mockResolvedValueOnce(
        Response.json({ job: { id: "v1", status: "failed" } }),
      );
    vi.stubGlobal("fetch", fetch);
    renderWithPending();

    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS));
    expect(state().pending).toEqual(["v1"]);
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(state()).toEqual({
      generations: [],
      pending: [],
      videoFailed: true,
    });
  });

  test("retries on the next round after a network error", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        Response.json({
          job: { id: "v1", status: "succeeded", generation: video },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    renderWithPending();
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2));
    expect(state().generations).toEqual(["v1"]);
  });

  test("aborts the in-flight request on unmount and schedules no further round", async () => {
    let signal: AbortSignal | undefined;
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      // The server is copying the video to storage: this round never returns.
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal("fetch", fetch);
    const view = renderWithPending();

    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(false);

    view.unmount();
    expect(signal?.aborted).toBe(true);

    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
