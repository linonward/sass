import { and, desc, eq, inArray } from "drizzle-orm";

import type { Database } from "@/core/db/client";
import { aiUsage, files } from "@/core/db/schema";

import type { Generation } from "./image";

export const GENERATIONS_LIMIT = 24;

/** 用户最近成功的图片、视频生成，新的在前。文件被删除的记录不返回。 */
export async function listGenerations(
  { db, fileUrl }: { db: Database; fileUrl: (key: string) => Promise<string> },
  { userId, limit = GENERATIONS_LIMIT }: { userId: string; limit?: number },
): Promise<Generation[]> {
  const rows = await db
    .select({
      id: aiUsage.id,
      kind: aiUsage.kind,
      modelId: aiUsage.modelId,
      prompt: aiUsage.prompt,
      createdAt: aiUsage.createdAt,
      fileId: files.id,
      key: files.key,
      mime: files.mime,
    })
    .from(aiUsage)
    .innerJoin(files, eq(files.id, aiUsage.fileId))
    .where(
      and(
        eq(aiUsage.userId, userId),
        eq(aiUsage.status, "succeeded"),
        inArray(aiUsage.kind, ["image", "video"]),
      ),
    )
    .orderBy(desc(aiUsage.createdAt))
    .limit(limit);

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      kind: row.kind as Generation["kind"],
      fileId: row.fileId,
      modelId: row.modelId,
      prompt: row.prompt ?? "",
      url: await fileUrl(row.key),
      mime: row.mime,
      createdAt: row.createdAt.toISOString(),
    })),
  );
}

/** 用户还在生成中的视频（新的在前），前端据此继续轮询。 */
export async function listPendingVideos(
  db: Database,
  userId: string,
): Promise<
  { id: string; modelId: string; prompt: string; createdAt: string }[]
> {
  const rows = await db
    .select({
      id: aiUsage.id,
      modelId: aiUsage.modelId,
      prompt: aiUsage.prompt,
      createdAt: aiUsage.createdAt,
    })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.userId, userId),
        eq(aiUsage.status, "pending"),
        eq(aiUsage.kind, "video"),
      ),
    )
    .orderBy(desc(aiUsage.createdAt))
    .limit(GENERATIONS_LIMIT);
  return rows.map((row) => ({
    ...row,
    prompt: row.prompt ?? "",
    createdAt: row.createdAt.toISOString(),
  }));
}
