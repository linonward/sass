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
  /** Versions this grant can download, newest first. */
  releases: DownloadRelease[];
};

/**
 * All of a user's grants (newest purchase first), each with the versions it can download. Queries
 * always filter by user_id.
 */
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
 * A version the user can download; null if the version doesn't exist, there's no grant, the grant
 * was revoked or the version came after the updates period. These cases aren't distinguished: the
 * outside only hears "no", without revealing what others bought or which versions were released.
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
