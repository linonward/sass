import { eq } from "drizzle-orm";
import type { Database } from "@/core/db";
import { userAttribution } from "@/core/db/schema";
import type { Attribution } from "./context";

export function createAttributionStore(db: Database) {
  return {
    async freeze(userId: string, snapshot: Attribution, registeredAt: number) {
      await db
        .insert(userAttribution)
        .values({ userId, snapshot, registeredAt: new Date(registeredAt) })
        .onConflictDoNothing();
    },
    async withdraw(userId: string) {
      const now = new Date();
      await db
        .insert(userAttribution)
        .values({ userId, snapshot: null, registeredAt: now, withdrawnAt: now })
        .onConflictDoUpdate({
          target: userAttribution.userId,
          set: { snapshot: null, withdrawnAt: now },
        });
    },
    async get(userId: string) {
      const [row] = await db
        .select()
        .from(userAttribution)
        .where(eq(userAttribution.userId, userId));
      return row ?? null;
    },
  };
}
