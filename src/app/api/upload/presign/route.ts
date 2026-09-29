import { handlePresign } from "@/core/upload/handlers";
import { uploadRouteContext } from "@/core/upload/routes";

/** Issue a presigned upload URL. Body: { mime, size }; see src/core/upload/handlers.ts. */
export async function POST(request: Request) {
  return handlePresign(request, uploadRouteContext);
}
