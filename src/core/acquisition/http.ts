import { readSmallBody } from "./request-body";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ATTRIBUTION_SECONDS, captureEntry } from "./context";
import {
  cookieOptions,
  readContext,
  readCookie,
  RETRY_COOKIE,
  signContext,
  SOURCE_COOKIE,
  SOURCE_CHOICE_COOKIE,
  sourceFromHeaders,
} from "./tokens";
import type { createAttributionStore } from "./store";

const inputSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("accept"), entry: z.unknown() }),
  z.strictObject({ action: z.literal("withdraw") }),
  z.strictObject({ action: z.literal("sync") }),
]);
type Dependencies = {
  enabled: boolean;
  secret: string;
  getUserId: (headers: Headers) => Promise<string | null>;
  store: Pick<ReturnType<typeof createAttributionStore>, "freeze" | "withdraw">;
  warn: (event: string) => void;
};
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function createAttributionHandlers(deps: Dependencies) {
  return {
    GET(request: Request) {
      if (!deps.enabled) return json({ error: "not_found" }, 404);
      const pending = readContext(
        readCookie(request.headers, RETRY_COOKIE),
        deps.secret,
      );
      return json({
        accepted: !!sourceFromHeaders(request.headers, deps.secret),
        pending: pending?.purpose === "registration",
      });
    },
    async POST(request: Request) {
      if (!deps.enabled) return json({ error: "not_found" }, 404);
      // All writes (including anonymous consent) require an exact same-origin JSON POST.
      if (
        request.headers.get("origin") !== new URL(request.url).origin ||
        request.headers.get("content-type")?.split(";")[0] !==
          "application/json"
      )
        return json({ error: "forbidden" }, 403);
      const parsed = inputSchema.safeParse(await readSmallBody(request));
      if (!parsed.success) return json({ error: "invalid" }, 400);
      const input = parsed.data;
      if (input.action === "accept") {
        const existing = sourceFromHeaders(request.headers, deps.secret);
        const snapshot =
          existing ?? captureEntry(input.entry, new URL(request.url).hostname);
        if (!snapshot) return json({ error: "invalid" }, 400);
        const response = json({ accepted: true });
        response.cookies.set(SOURCE_CHOICE_COOKIE, "", {
          ...cookieOptions,
          maxAge: 0,
        });
        // Do not refresh the clock on a direct return or a later campaign.
        if (!existing)
          response.cookies.set(
            SOURCE_COOKIE,
            signContext(
              { v: 1, purpose: "source", attribution: snapshot },
              deps.secret,
            ),
            { ...cookieOptions, maxAge: ATTRIBUTION_SECONDS },
          );
        return response;
      }
      try {
        if (input.action === "withdraw") {
          const userId = await deps.getUserId(request.headers);
          if (userId) await deps.store.withdraw(userId);
          const response = json({ accepted: false });
          response.cookies.set(SOURCE_CHOICE_COOKIE, "declined", {
            ...cookieOptions,
            maxAge: ATTRIBUTION_SECONDS,
          });
          for (const cookie of [SOURCE_COOKIE, RETRY_COOKIE])
            response.cookies.set(cookie, "", { ...cookieOptions, maxAge: 0 });
          return response;
        }
        const pending = readContext(
          readCookie(request.headers, RETRY_COOKIE),
          deps.secret,
        );
        if (pending?.purpose !== "registration") return json({ synced: false });
        const userId = await deps.getUserId(request.headers);
        if (userId !== pending.userId)
          return json({ error: "unauthorized" }, 401);
        await deps.store.freeze(
          userId,
          pending.attribution,
          pending.registeredAt,
        );
        const response = json({ synced: true });
        response.cookies.set(RETRY_COOKIE, "", { ...cookieOptions, maxAge: 0 });
        return response;
      } catch {
        deps.warn("acquisition.request_failed");
        const response = json({ error: "retry" }, 503);
        // Stop anonymous capture even if clearing the account snapshot must be retried.
        if (input.action === "withdraw")
          response.cookies.set(SOURCE_CHOICE_COOKIE, "declined", {
            ...cookieOptions,
            maxAge: ATTRIBUTION_SECONDS,
          });
        if (input.action === "withdraw")
          for (const cookie of [SOURCE_COOKIE, RETRY_COOKIE])
            response.cookies.set(cookie, "", { ...cookieOptions, maxAge: 0 });
        return response;
      }
    },
  };
}
