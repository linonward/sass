import { handlePresign } from "@/core/upload/handlers";
import { uploadRouteContext } from "@/core/upload/routes";

/** 签发预签名上传地址。body：{ mime, size }；见 src/core/upload/handlers.ts。 */
export async function POST(request: Request) {
  return handlePresign(request, uploadRouteContext);
}
