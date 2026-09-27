import type { RateLimitResult } from "@/core/ratelimit/limiter";
import { getClientIp, rateLimitResponse } from "@/core/ratelimit/limiter";
import { readSmallBody } from "../request-body";
import type { Attribution } from "../context";
import { leadRequest } from "./input";
import type { createLeadService } from "./service";

type Dependencies = {
  enabled: boolean;
  lists: { id: string; consentVersion: string }[];
  locales: readonly string[];
  service: ReturnType<typeof createLeadService>;
  limit: (email: string, ip: string | null) => Promise<RateLimitResult>;
  actionLimit: (ip: string | null) => Promise<RateLimitResult>;
  source: (headers: Headers) => Attribution | null;
  consentText: (listId: string, locale: string) => Promise<string>;
  send: (mail: {
    email: string;
    listId: string;
    locale: string;
    confirmToken: string;
    withdrawToken: string;
  }) => Promise<unknown>;
  warn: (event: string) => void;
};
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export function createLeadHandler(deps: Dependencies) {
  return async (request: Request) => {
    if (!deps.enabled) return json({ error: "not_found" }, 404);
    if (
      request.headers.get("origin") !== new URL(request.url).origin ||
      request.headers.get("content-type")?.split(";")[0] !== "application/json"
    )
      return json({ error: "forbidden" }, 403);
    const parsed = leadRequest.safeParse(await readSmallBody(request));
    if (!parsed.success) return json({ error: "invalid" }, 400);
    const input = parsed.data;
    try {
      if (input.action !== "submit") {
        const limit = await deps.actionLimit(getClientIp(request.headers));
        if (!limit.ok) return rateLimitResponse(limit);
      }
      if (input.action === "withdraw") {
        await deps.service.withdraw(input.token);
        return json({ ok: true });
      }
      if (input.action === "confirm")
        return (await deps.service.confirm(input.token))
          ? json({ ok: true })
          : json({ error: "expired" }, 400);
      const list = deps.lists.find((list) => list.id === input.listId);
      if (!list || !deps.locales.includes(input.locale))
        return json({ error: "invalid" }, 400);
      if (input.website) return json({ ok: true }); // honeypot: no writes or mail
      const limit = await deps.limit(input.email, getClientIp(request.headers));
      if (!limit.ok) return rateLimitResponse(limit);
      const delivery = await deps.service.prepare({
        email: input.email,
        listId: list.id,
        consentVersion: list.consentVersion,
        consentText: await deps.consentText(list.id, input.locale),
        snapshot: deps.source(request.headers),
      });
      if (delivery) {
        try {
          await deps.send({
            ...delivery,
            listId: list.id,
            locale: input.locale,
          });
        } catch {
          await deps.service.releaseSend(delivery.id, delivery.confirmToken);
          throw new Error("mail_failed");
        }
      }
      // Same body for first submission, cooldown, pending and confirmed leads.
      return json({ ok: true });
    } catch {
      deps.warn("leads.request_failed");
      return json({ error: "retry" }, 503);
    }
  };
}
