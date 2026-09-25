// @vitest-environment node
import { S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createR2Storage } from "./storage";

const storage = createR2Storage({
  accountId: "0123456789abcdef0123456789abcdef",
  accessKeyId: "key",
  secretAccessKey: "secret",
  bucket: "uploads",
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("R2 预签名地址", () => {
  test("PUT 地址指向 R2，签名覆盖 Content-Type 和 Content-Length，不带校验和", async () => {
    const url = new URL(
      await storage.presignPut({
        key: "u1/2026-09/x.png",
        mime: "image/png",
        size: 1234,
        expiresIn: 600,
      }),
    );
    expect(url.origin).toBe(
      "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
    );
    expect(url.pathname).toBe("/uploads/u1/2026-09/x.png");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-length;content-type;host",
    );
    // 签名时没有文件内容，SDK 默认写进去的 CRC32 会让浏览器上传被拒绝。
    const params = [...url.searchParams.keys()].map((k) => k.toLowerCase());
    expect(params.filter((k) => k.includes("checksum"))).toEqual([]);
  });

  test("GET 地址带有效期，只签 host", async () => {
    const url = new URL(
      await storage.presignGet({ key: "u1/2026-09/x.png", expiresIn: 3600 }),
    );
    expect(url.pathname).toBe("/uploads/u1/2026-09/x.png");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });
});

describe("head", () => {
  test("返回对象的大小和类型", async () => {
    const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
      ContentLength: 10,
      ContentType: "image/png",
    } as never);
    await expect(storage.head("k")).resolves.toEqual({
      size: 10,
      mime: "image/png",
    });
    expect(send.mock.calls[0][0].input).toEqual({
      Bucket: "uploads",
      Key: "k",
    });
  });

  test("对象不存在时返回 null，其他错误抛出", async () => {
    const error = (status: number) =>
      new S3ServiceException({
        name: status === 404 ? "NotFound" : "InternalError",
        $fault: status === 404 ? "client" : "server",
        $metadata: { httpStatusCode: status },
      });
    vi.spyOn(S3Client.prototype, "send").mockRejectedValueOnce(error(404));
    await expect(storage.head("k")).resolves.toBeNull();
    vi.spyOn(S3Client.prototype, "send").mockRejectedValueOnce(error(500));
    await expect(storage.head("k")).rejects.toThrow();
  });
});
