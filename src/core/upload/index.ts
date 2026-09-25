import { env } from "@/core/env";

import siteConfig from "../../../site.config";
import type { UploadDeps } from "./service";
import { createR2Storage, type ObjectStorage } from "./storage";

export {
  completeUpload,
  fileUrl,
  getFileUrl,
  presignUpload,
  type UploadedFile,
  type UploadError,
} from "./service";

/** `features.upload` 是否开启。关闭时上传接口返回 404。 */
export const uploadEnabled = siteConfig.features.upload;

let storage: ObjectStorage | null | undefined;

/** 按 env 创建的 R2 存储；缺少任一 R2 变量时为 null（接口返回 503）。 */
export function getUploadStorage(): ObjectStorage | null {
  if (storage === undefined) {
    const {
      R2_ACCOUNT_ID: accountId,
      R2_ACCESS_KEY_ID: accessKeyId,
      R2_SECRET_ACCESS_KEY: secretAccessKey,
      R2_BUCKET: bucket,
    } = env;
    storage =
      accountId && accessKeyId && secretAccessKey && bucket
        ? createR2Storage({ accountId, accessKeyId, secretAccessKey, bucket })
        : null;
  }
  return storage;
}

/** 绑定全局数据库、R2 和站点配置的依赖，传给 presignUpload 等函数。 */
export function uploadDeps(db: UploadDeps["db"]): UploadDeps {
  return {
    db,
    storage: getUploadStorage(),
    config: siteConfig.upload,
    publicUrl: env.R2_PUBLIC_URL,
  };
}
