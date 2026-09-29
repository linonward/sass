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

describe("R2 presigned URLs", () => {
  test("PUT URL points to R2, signs Content-Type and Content-Length, and carries no checksum", async () => {
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
    // There is no file content at signing time; the CRC32 the SDK adds by default would get the
    // browser's upload rejected.
    const params = [...url.searchParams.keys()].map((k) => k.toLowerCase());
    expect(params.filter((k) => k.includes("checksum"))).toEqual([]);
  });

  test("GET URL has an expiry and signs only host", async () => {
    const url = new URL(
      await storage.presignGet({ key: "u1/2026-09/x.png", expiresIn: 3600 }),
    );
    expect(url.pathname).toBe("/uploads/u1/2026-09/x.png");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });
});

describe("putObject", () => {
  test("writes to the bucket with the type and body", async () => {
    const send = vi
      .spyOn(S3Client.prototype, "send")
      .mockResolvedValue({} as never);
    const body = new Uint8Array([1, 2, 3]);
    await storage.putObject({ key: "k.png", mime: "image/png", body });
    expect(send.mock.calls[0]![0].input).toEqual({
      Bucket: "uploads",
      Key: "k.png",
      ContentType: "image/png",
      Body: body,
    });
  });
});

describe("head", () => {
  test("returns the object's size and type", async () => {
    const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
      ContentLength: 10,
      ContentType: "image/png",
    } as never);
    await expect(storage.head("k")).resolves.toEqual({
      size: 10,
      mime: "image/png",
    });
    expect(send.mock.calls[0]![0].input).toEqual({
      Bucket: "uploads",
      Key: "k",
    });
  });

  test("returns null when the object doesn't exist and rethrows other errors", async () => {
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
