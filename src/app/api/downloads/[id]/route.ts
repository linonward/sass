import { auth } from "@/core/auth/server";
import { getDb } from "@/core/db";
import { getUploadStorage } from "@/core/upload";
import { handleDownload } from "@/features/downloads/route";

import siteConfig from "../../../../../site.config";

/** 下载某个版本：校验授权后跳到 5 分钟有效的私有地址；见 src/features/downloads/route.ts。 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/downloads/[id]">,
) {
  const { id } = await params;
  return handleDownload(request, id, {
    enabled: siteConfig.downloads.enabled,
    getUserId: async (req) => {
      const session = await auth.api.getSession({ headers: req.headers });
      return session?.user.id ?? null;
    },
    db: getDb,
    storage: getUploadStorage,
  });
}
