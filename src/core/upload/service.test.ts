// @vitest-environment node
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import { uploadConfigSchema } from "@/core/config/schema";
import { createDbClient, type DbClient } from "@/core/db/client";
import { files, user } from "@/core/db/schema";

import {
  completeUpload,
  getFileUrl,
  presignUpload,
  type UploadDeps,
} from "./service";
import { MemoryStorage } from "./testing";

const url = process.env.DATABASE_URL_TEST;
if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}

const config = uploadConfigSchema.parse({
  allowedMimeTypes: ["image/png", "application/pdf"],
  maxFileSize: 1000,
});

describe.skipIf(!url)("upload service", () => {
  let client: DbClient;
  let storage: MemoryStorage;
  let deps: UploadDeps;
  let userId: string;
  let otherId: string;

  const createUser = async (id: string) => {
    await client.db.insert(user).values({
      id,
      name: "Upload Test",
      email: `upload-${id}@example.com`,
      emailVerified: true,
    });
  };

  const presign = (mime: unknown = "image/png", size: unknown = 100) =>
    presignUpload(
      deps,
      { userId, mime, size },
      new Date("2026-09-25T00:00:00Z"),
    );

  async function presignOk() {
    const result = await presign();
    if (!result.ok) throw new Error(result.error);
    return result;
  }

  beforeAll(() => {
    client = createDbClient(url!);
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    storage = new MemoryStorage();
    deps = { db: client.db, storage, config };
    userId = randomUUID();
    otherId = randomUUID();
    await createUser(userId);
    await createUser(otherId);
  });

  afterEach(async () => {
    await client.db.delete(user).where(eq(user.id, userId));
    await client.db.delete(user).where(eq(user.id, otherId));
  });

  test("presign: records a pending row and returns the PUT URL plus the required Content-Type", async () => {
    const result = await presignOk();
    expect(result.key).toMatch(
      new RegExp(`^${userId}/2026-09/[0-9a-f-]{36}\\.png$`),
    );
    expect(result.uploadUrl).toBe(
      `https://r2.test/put/${result.key}?mime=image%2Fpng&size=100&expires=600`,
    );
    expect(result.headers).toEqual({ "Content-Type": "image/png" });

    const [row] = await client.db
      .select()
      .from(files)
      .where(eq(files.id, result.fileId));
    expect(row).toMatchObject({
      userId,
      key: result.key,
      size: 100,
      mime: "image/png",
      status: "pending",
    });
  });

  test("rejects an invalid type or size at presign without writing to the database", async () => {
    await expect(presign("image/gif")).resolves.toEqual({
      ok: false,
      error: "invalid_type",
      status: 400,
    });
    await expect(presign("image/png", 1001)).resolves.toEqual({
      ok: false,
      error: "too_large",
      status: 413,
    });
    await expect(presign("image/png", 0)).resolves.toMatchObject({
      error: "invalid_size",
      status: 400,
    });
    const rows = await client.db
      .select()
      .from(files)
      .where(eq(files.userId, userId));
    expect(rows).toEqual([]);
  });

  test("returns 503 when R2 isn't configured", async () => {
    deps = { ...deps, storage: null };
    await expect(presign()).resolves.toMatchObject({
      error: "upload_not_configured",
      status: 503,
    });
    await expect(
      completeUpload(deps, { userId, fileId: "x" }),
    ).resolves.toMatchObject({ status: 503 });
  });

  test("complete: marks uploaded when the object exists and matches, returns a signed GET URL for private files; confirming again gives the same result", async () => {
    const { fileId, key } = await presignOk();
    storage.put(key, { size: 100, mime: "image/png" });

    const first = await completeUpload(deps, { userId, fileId });
    expect(first).toEqual({
      ok: true,
      file: {
        id: fileId,
        key,
        size: 100,
        mime: "image/png",
        url: `https://r2.test/get/${key}?expires=3600`,
      },
    });
    const [row] = await client.db
      .select()
      .from(files)
      .where(eq(files.id, fileId));
    expect(row!.status).toBe("uploaded");

    await expect(completeUpload(deps, { userId, fileId })).resolves.toEqual(
      first,
    );
  });

  test("returns a URL on the public origin for public access", async () => {
    deps = {
      ...deps,
      config: { ...config, public: true },
      publicUrl: "https://files.example.com/",
    };
    const { fileId, key } = await presignOk();
    storage.put(key, { size: 100, mime: "image/png" });
    await expect(
      completeUpload(deps, { userId, fileId }),
    ).resolves.toMatchObject({
      file: { url: `https://files.example.com/${key}` },
    });
  });

  test("returns 409 when the object doesn't exist yet and keeps the row pending", async () => {
    const { fileId } = await presignOk();
    await expect(
      completeUpload(deps, { userId, fileId }),
    ).resolves.toMatchObject({ error: "not_uploaded", status: 409 });
    const [row] = await client.db
      .select()
      .from(files)
      .where(eq(files.id, fileId));
    expect(row!.status).toBe("pending");
  });

  test.each([
    ["size", { size: 999, mime: "image/png" }],
    ["type", { size: 100, mime: "application/pdf" }],
  ])(
    "object %s differs from what was signed: deletes the object and returns 422",
    async (_, object) => {
      const { fileId, key } = await presignOk();
      storage.put(key, object);
      await expect(
        completeUpload(deps, { userId, fileId }),
      ).resolves.toMatchObject({ error: "mismatch", status: 422 });
      expect(storage.deleted).toEqual([key]);
    },
  );

  test("compares by the base type when the type has parameters", async () => {
    const { fileId, key } = await presignOk();
    storage.put(key, { size: 100, mime: "IMAGE/PNG; charset=binary" });
    await expect(
      completeUpload(deps, { userId, fileId }),
    ).resolves.toMatchObject({ ok: true });
  });

  test("cannot confirm or access someone else's file", async () => {
    const { fileId, key } = await presignOk();
    storage.put(key, { size: 100, mime: "image/png" });
    await expect(
      completeUpload(deps, { userId: otherId, fileId }),
    ).resolves.toMatchObject({ error: "not_found", status: 404 });
    await completeUpload(deps, { userId, fileId });
    await expect(
      getFileUrl(deps, { userId: otherId, fileId }),
    ).resolves.toBeNull();
    await expect(getFileUrl(deps, { userId, fileId })).resolves.toBe(
      `https://r2.test/get/${key}?expires=3600`,
    );
  });

  test("pending files have no URL; an invalid fileId is treated as nonexistent", async () => {
    const { fileId } = await presignOk();
    await expect(getFileUrl(deps, { userId, fileId })).resolves.toBeNull();
    await expect(
      completeUpload(deps, { userId, fileId: 42 }),
    ).resolves.toMatchObject({ error: "not_found" });
  });

  test("deleting a user deletes their file rows too", async () => {
    const { fileId } = await presignOk();
    await client.db.delete(user).where(eq(user.id, userId));
    const rows = await client.db
      .select()
      .from(files)
      .where(eq(files.id, fileId));
    expect(rows).toEqual([]);
  });
});
