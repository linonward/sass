import { handleComplete } from "@/core/upload/handlers";
import { uploadRouteContext } from "@/core/upload/routes";

/** 确认上传完成。body：{ fileId }；见 src/core/upload/handlers.ts。 */
export async function POST(request: Request) {
  return handleComplete(request, uploadRouteContext);
}
