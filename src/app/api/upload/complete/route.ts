import { handleComplete } from "@/core/upload/handlers";
import { uploadRouteContext } from "@/core/upload/routes";

/** Confirm an upload finished. Body: { fileId }; see src/core/upload/handlers.ts. */
export async function POST(request: Request) {
  return handleComplete(request, uploadRouteContext);
}
