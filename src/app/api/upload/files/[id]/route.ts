import { handleFileRedirect } from "@/core/upload/handlers";
import { uploadRouteContext } from "@/core/upload/routes";

/** Redirect to the URL of a file you uploaded; see src/core/upload/handlers.ts. */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/upload/files/[id]">,
) {
  const { id } = await params;
  return handleFileRedirect(request, id, uploadRouteContext);
}
