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
  render(
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

describe("GenerationsProvider 轮询", () => {
  test("上一次查询没返回时不重复查询；完成后只加一次", async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal("fetch", fetch);
    renderWithPending();

    // 第一次查询一直不返回（服务端在转存视频），过几个轮询间隔也不会再发。
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/ai/video/v1");

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

    // 没有待完成的任务后不再轮询。
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("还在生成时按间隔继续查；失败时标记 videoFailed", async () => {
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

  test("网络错误下一轮再查", async () => {
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
});
