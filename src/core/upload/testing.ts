import type { ObjectStorage } from "./storage";

/**
 * In-memory object storage for tests. `put()` simulates a successful direct upload from the
 * browser; presigned URLs are readable fake URLs, easy to assert on.
 */
export class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, { size: number; mime: string | null }>();
  readonly deleted: string[] = [];
  readonly bodies = new Map<string, Uint8Array>();

  put(key: string, object: { size: number; mime: string | null }) {
    this.objects.set(key, object);
  }

  async presignPut({
    key,
    mime,
    size,
    expiresIn,
  }: Parameters<ObjectStorage["presignPut"]>[0]) {
    return `https://r2.test/put/${key}?mime=${encodeURIComponent(mime)}&size=${size}&expires=${expiresIn}`;
  }

  async putObject({
    key,
    mime,
    body,
  }: Parameters<ObjectStorage["putObject"]>[0]) {
    this.objects.set(key, { size: body.byteLength, mime });
    this.bodies.set(key, body);
  }

  async presignGet({ key, expiresIn }: { key: string; expiresIn: number }) {
    return `https://r2.test/get/${key}?expires=${expiresIn}`;
  }

  async head(key: string) {
    return this.objects.get(key) ?? null;
  }

  async delete(key: string) {
    this.objects.delete(key);
    this.deleted.push(key);
  }
}
