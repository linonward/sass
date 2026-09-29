import { and, desc, eq, inArray } from "drizzle-orm";

import type { Database } from "@/core/db";

import { canDownload } from "./access";
import {
  downloadEntitlements,
  downloadReleases,
  type DownloadEntitlement,
  type DownloadRelease,
} from "./schema";

export type DownloadEntry = DownloadEntitlement & {
  /** 这份授权能下的版本，新的在前。 */
  releases: DownloadRelease[];
};

/** 用户的全部授权（新买的在前），每份带上它能下的版本。查询永远带 user_id。 */
export async function listDownloads(
  db: Database,
  userId: string,
): Promise<DownloadEntry[]> {
  const entitlements = await db
    .select()
    .from(downloadEntitlements)
    .where(eq(downloadEntitlements.userId, userId))
    .orderBy(desc(downloadEntitlements.purchasedAt));
  if (entitlements.length === 0) return [];

  const releases = await db
    .select()
    .from(downloadReleases)
    .where(
      inArray(downloadReleases.productId, [
        ...new Set(entitlements.map((e) => e.productId)),
      ]),
    )
    .orderBy(desc(downloadReleases.publishedAt));

  return entitlements.map((entitlement) => ({
    ...entitlement,
    releases: releases.filter((release) => canDownload(entitlement, release)),
  }));
}

/**
 * 用户能下的某个版本；版本不存在、没有授权、授权被收回或版本在更新期之后，一律 null。
 * 不区分这几种情况：对外只说「没有」，不透露别人买了什么、发过哪些版本。
 */
export async function findDownload(
  db: Database,
  userId: string,
  releaseId: string,
): Promise<DownloadRelease | null> {
  const [release] = await db
    .select()
    .from(downloadReleases)
    .where(eq(downloadReleases.id, releaseId));
  if (!release) return null;
  const entitlements = await db
    .select()
    .from(downloadEntitlements)
    .where(
      and(
        eq(downloadEntitlements.userId, userId),
        eq(downloadEntitlements.productId, release.productId),
      ),
    );
  return entitlements.some((e) => canDownload(e, release)) ? release : null;
}
