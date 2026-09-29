import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Database } from "@/core/db";
import type { ObjectStorage } from "@/core/upload/storage";

const findDownload = vi.fn();
vi.mock("./queries", () => ({
  findDownload: (...args: unknown[]) => findDownload(...args),
}));

const { DOWNLOAD_URL_TTL_SECONDS, handleDownload } = await import("./route");

const release = {
  id: "rel_1",
  productId: "template",
  version: "1.0.0",
  objectKey: "downloads/template/1.0.0/onwardkit-1.0.0.zip",
  size: 1024,
  publishedAt: new Date(),
};

function context(
  overrides: Partial<Parameters<typeof handleDownload>[2]> = {},
) {
  const storage = {
    presignGet: vi.fn(async () => "https://r2.example.com/signed"),
  } as unknown as ObjectStorage;
  return {
    storage,
    ctx: {
      enabled: true,
      getUserId: async () => "u1",
      db: () => ({}) as Database,
      storage: () => storage,
      ...overrides,
    },
  };
}

const request = new Request("https://example.com/api/downloads/rel_1");

beforeEach(() => {
  findDownload.mockReset();
});

describe("GET /api/downloads/<id>", () => {
  test("有授权：现签一个 5 分钟的地址并 302 过去，不缓存", async () => {
    findDownload.mockResolvedValue(release);
    const { ctx, storage } = context();
    const response = await handleDownload(request, "rel_1", ctx);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://r2.example.com/signed",
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(storage.presignGet).toHaveBeenCalledWith({
      key: release.objectKey,
      expiresIn: DOWNLOAD_URL_TTL_SECONDS,
    });
    expect(findDownload).toHaveBeenCalledWith(expect.anything(), "u1", "rel_1");
  });

  test("模块关闭 404、没登录 401，都不查库", async () => {
    expect(
      (await handleDownload(request, "rel_1", context({ enabled: false }).ctx))
        .status,
    ).toBe(404);
    expect(
      (
        await handleDownload(
          request,
          "rel_1",
          context({ getUserId: async () => null }).ctx,
        )
      ).status,
    ).toBe(401);
    expect(findDownload).not.toHaveBeenCalled();
  });

  test("没有授权（或版本不存在）一律 404，不签地址", async () => {
    findDownload.mockResolvedValue(null);
    const { ctx, storage } = context();
    expect((await handleDownload(request, "rel_1", ctx)).status).toBe(404);
    expect(storage.presignGet).not.toHaveBeenCalled();
  });

  test("没配对象存储时 503", async () => {
    findDownload.mockResolvedValue(release);
    expect(
      (
        await handleDownload(
          request,
          "rel_1",
          context({ storage: () => null }).ctx,
        )
      ).status,
    ).toBe(503);
  });
});
