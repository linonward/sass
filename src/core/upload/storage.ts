import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** 上传模块用到的对象存储操作。生产用 R2，测试用内存实现。 */
export type ObjectStorage = {
  /** 预签名 PUT 地址。浏览器必须带上同样的 Content-Type，且文件大小必须等于 size。 */
  presignPut(input: {
    key: string;
    mime: string;
    size: number;
    expiresIn: number;
  }): Promise<string>;
  /** 服务端直接写入对象（比如 AI 生成的图片、视频）。 */
  putObject(input: {
    key: string;
    mime: string;
    body: Uint8Array;
  }): Promise<void>;
  /** 预签名 GET 地址，用于访问私有文件。 */
  presignGet(input: { key: string; expiresIn: number }): Promise<string>;
  /** 对象的大小和类型；不存在时返回 null。 */
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
    // 地址统一用 <endpoint>/<bucket>/<key>，不随 bucket 名切换成子域名（带点的 bucket 名在子域名下证书不匹配）。
    forcePathStyle: true,
    // SDK 默认会给 PUT 算 CRC32 校验和并写进预签名地址；签名时还没有文件内容，
    // 浏览器上传的内容和这个校验和对不上，R2 会拒绝。只在接口要求时才计算。
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/** Cloudflare R2（S3 兼容接口）实现。 */
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
          // presigner 默认不签 Content-Type。把它和 Content-Length 都签进去，
          // 浏览器发来的类型或大小与签发时不同，R2 会返回 403。
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
