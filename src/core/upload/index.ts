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

/** Whether `features.upload` is on. When off, the upload API returns 404. */
export const uploadEnabled = siteConfig.features.upload;

let storage: ObjectStorage | null | undefined;

/** R2 storage built from env; null when any R2 variable is missing (the API returns 503). */
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

/** Dependencies bound to the global database, R2 and site config, passed to presignUpload and friends. */
export function uploadDeps(db: UploadDeps["db"]): UploadDeps {
  return {
    db,
    storage: getUploadStorage(),
    config: siteConfig.upload,
    publicUrl: env.R2_PUBLIC_URL,
  };
}
