import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Object storage operations used by the upload module. R2 in production, in-memory in tests. */
export type ObjectStorage = {
  /** Presigned PUT URL. The browser must send the same Content-Type, and the file size must equal size. */
  presignPut(input: {
    key: string;
    mime: string;
    size: number;
    expiresIn: number;
  }): Promise<string>;
  /** Writes an object directly from the server (e.g. AI-generated images or videos). */
  putObject(input: {
    key: string;
    mime: string;
    body: Uint8Array;
  }): Promise<void>;
  /** Presigned GET URL, used to access private files. */
  presignGet(input: { key: string; expiresIn: number }): Promise<string>;
  /** The object's size and type; null if it doesn't exist. */
  head(key: string): Promise<{ size: number; mime: string | null } | null>;
  delete(key: string): Promise<void>;
};

export type R2Options = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export function createR2Client({
  accountId,
  accessKeyId,
  secretAccessKey,
}: Omit<R2Options, "bucket">) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    // Always use <endpoint>/<bucket>/<key> URLs rather than switching to a bucket subdomain (a
    // bucket name containing dots breaks the TLS certificate match on the subdomain).
    forcePathStyle: true,
    // By default the SDK computes a CRC32 checksum for PUT and writes it into the presigned URL;
    // there is no file content at signing time, so the browser's upload won't match that checksum
    // and R2 rejects it. Only compute it when the API requires one.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/** Cloudflare R2 implementation (S3-compatible API). */
export function createR2Storage(options: R2Options): ObjectStorage {
  const client = createR2Client(options);
  const Bucket = options.bucket;

  return {
    presignPut: ({ key, mime, size, expiresIn }) =>
      getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket,
          Key: key,
          ContentType: mime,
          ContentLength: size,
        }),
        {
          expiresIn,
          // The presigner doesn't sign Content-Type by default. Sign it along with
          // Content-Length, so R2 returns 403 if the browser sends a type or size that differs
          // from what was signed.
          signableHeaders: new Set(["content-type", "content-length"]),
        },
      ),
    putObject: async ({ key, mime, body }) => {
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          ContentType: mime,
          Body: body,
        }),
      );
    },
    presignGet: ({ key, expiresIn }) =>
      getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), {
        expiresIn,
      }),
    head: async (key) => {
      try {
        const result = await client.send(
          new HeadObjectCommand({ Bucket, Key: key }),
        );
        return {
          size: result.ContentLength ?? 0,
          mime: result.ContentType ?? null,
        };
      } catch (error) {
        if (
          error instanceof S3ServiceException &&
          error.$metadata.httpStatusCode === 404
        ) {
          return null;
        }
        throw error;
      }
    },
    delete: async (key) => {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}
