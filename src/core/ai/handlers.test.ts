// @vitest-environment node
import { describe, expect, test, vi } from "vitest";

import {
  handleGenerations,
  handleImage,
  handleVideoStart,
  handleVideoStatus,
  MAX_IMAGE_BODY_BYTES,
} from "./handlers";
import type { Generation, RunImageResult } from "./image";

const generation: Generation = {
  id: "g1",
  kind: "image",
  fileId: "f1",
  modelId: "img",
  prompt: "a boy",
  url: "https://files.test/k.png",
  mime: "image/png",
  createdAt: "2026-09-25T00:00:00.000Z",
};

function post(body: string) {
  return new Request("http://localhost/api/ai/image", {
    method: "POST",
    headers: { "x-forwarded-for": "1.2.3.4" },
    body,
  });
}

function deps(result: RunImageResult = { ok: true, generation }) {
  return {
    enabled: true,
    getUserId: vi.fn(async () => "u1" as string | null),
    runImage: vi.fn(async () => result),
  };
}

describe("handleImage", () => {
  test("把提示词和选项交给 runImage，返回 generation", async () => {
    const d = deps();
    const response = await handleImage(
      post(
        JSON.stringify({
          prompt: "a boy",
          modelId: "img",
          aspectRatio: "16:9",
        }),
      ),
      d,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ generation });
    expect(d.runImage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        ip: "1.2.3.4",
        prompt: "a boy",
        modelId: "img",
        aspectRatio: "16:9",
      }),
    );
  });

  test("runImage 的错误响应原样返回", async () => {
    const response = await handleImage(
      post(JSON.stringify({ prompt: "a" })),
      deps({
        ok: false,
        status: 402,
        response: Response.json(
          { error: "insufficient_credits" },
          { status: 402 },
        ),
      }),
    );
    expect(response.status).toBe(402);
  });

  test.each([
    ["关闭时 404", { enabled: false }, JSON.stringify({ prompt: "a" }), 404],
    [
      "未登录 401",
      { getUserId: async () => null },
      JSON.stringify({ prompt: "a" }),
      401,
    ],
    ["不是 JSON 400", {}, "nope", 400],
    ["不是对象 400", {}, "1", 400],
    [
      "过大 413",
      {},
      JSON.stringify({ prompt: "x".repeat(MAX_IMAGE_BODY_BYTES) }),
      413,
    ],
  ])("%s", async (_name, override, body, status) => {
    const d = { ...deps(), ...override };
    const response = await handleImage(post(body), d);
    expect(response.status).toBe(status);
    expect(d.runImage).not.toHaveBeenCalled();
  });
});

describe("handleGenerations", () => {
  const get = () => new Request("http://localhost/api/ai/generations");

  test("返回当前用户的生成记录", async () => {
    const listGenerations = vi.fn(async () => [generation]);
    const response = await handleGenerations(get(), {
      enabled: true,
      getUserId: async () => "u1",
      listGenerations,
    });
    expect(await response.json()).toEqual({
      generations: [generation],
      pendingVideos: [],
    });
    expect(listGenerations).toHaveBeenCalledWith("u1");
  });

  test("关闭时 404，未登录 401", async () => {
    const listGenerations = vi.fn(async () => []);
    expect(
      (
        await handleGenerations(get(), {
          enabled: false,
          getUserId: async () => "u1",
          listGenerations,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await handleGenerations(get(), {
          enabled: true,
          getUserId: async () => null,
          listGenerations,
        })
      ).status,
    ).toBe(401);
    expect(listGenerations).not.toHaveBeenCalled();
  });
});

describe("video", () => {
  const job = { id: "v1", status: "pending" as const };

  test("提交：参数交给 startVideo，返回 202 和 job", async () => {
    const startVideo = vi.fn(async () => ({ ok: true as const, job }));
    const response = await handleVideoStart(
      post(
        JSON.stringify({
          prompt: "p",
          modelId: "i2v",
          imageFileId: "f1",
          aspectRatio: "16:9",
        }),
      ),
      { enabled: true, getUserId: async () => "u1", startVideo },
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ job });
    expect(startVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        ip: "1.2.3.4",
        prompt: "p",
        modelId: "i2v",
        imageFileId: "f1",
        aspectRatio: "16:9",
      }),
    );
  });

  test("查询：按 id 调 pollVideo", async () => {
    const pollVideo = vi.fn(async () => ({ ok: true as const, job }));
    const response = await handleVideoStatus(
      new Request("http://localhost/api/ai/video/v1"),
      "v1",
      { enabled: true, getUserId: async () => "u1", pollVideo },
    );
    expect(await response.json()).toEqual({ job });
    expect(pollVideo).toHaveBeenCalledWith({ userId: "u1", id: "v1" });
  });

  test("关闭时 404，未登录 401", async () => {
    const startVideo = vi.fn();
    const pollVideo = vi.fn();
    const req = () => post(JSON.stringify({ prompt: "p" }));
    expect(
      (
        await handleVideoStart(req(), {
          enabled: false,
          getUserId: async () => "u1",
          startVideo,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await handleVideoStart(req(), {
          enabled: true,
          getUserId: async () => null,
          startVideo,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await handleVideoStatus(req(), "v1", {
          enabled: true,
          getUserId: async () => null,
          pollVideo,
        })
      ).status,
    ).toBe(401);
    expect(startVideo).not.toHaveBeenCalled();
    expect(pollVideo).not.toHaveBeenCalled();
  });
});
