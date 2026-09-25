import { handleFileRedirect } from "@/core/upload/handlers";
import { uploadRouteContext } from "@/core/upload/routes";

/** 跳转到自己已上传文件的访问地址；见 src/core/upload/handlers.ts。 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/upload/files/[id]">,
) {
  const { id } = await params;
  return handleFileRedirect(request, id, uploadRouteContext);
}
