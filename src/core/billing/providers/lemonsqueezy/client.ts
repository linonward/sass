/**
 * Thin wrapper around the Lemon Squeezy API.
 *
 * Deliberately not using `@lemonsqueezy/lemonsqueezy.js`: the SDK's last release was 2024-11-05,
 * its repo has had no pushes since, and it is only a thin layer over fetch (plus a few type
 * definitions). Writing these few lines by hand means the only dependency surface is the official
 * HTTP API (no changes to package.json / pnpm-lock.yaml / THIRD-PARTY-NOTICES.md), and unit tests
 * can inject a fake fetch directly. Lemon Squeezy has no sunset plan for the API; see
 * https://docs.lemonsqueezy.com/api for its shape.
 */

export const LEMONSQUEEZY_API_BASE_URL = "https://api.lemonsqueezy.com";
export const LEMONSQUEEZY_PROVIDER_ID = "lemonsqueezy";

/**
 * The JSON:API media type; send it in both Accept and Content-Type, or the server treats the
 * request as plain JSON.
 */
const JSON_API_MEDIA_TYPE = "application/vnd.api+json";

/**
 * Response body truncation length: long enough for the error to show the cause, short enough not
 * to dump a whole HTML page into the logs.
 */
const ERROR_BODY_LIMIT = 500;

/**
 * A non-2xx response. Carries the status code and a body snippet so callers can branch on the
 * status (e.g. a 404 when canceling a subscription counts as success).
 */
export class LemonSqueezyApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Lemon Squeezy API responded ${status}: ${body}`);
    this.name = "LemonSqueezyApiError";
  }
}

/** Injectable fetch: tests inject a fake, production uses the global fetch. */
export type LemonSqueezyFetch = typeof fetch;

export type LemonSqueezyClientOptions = {
  apiKey: string;
  baseUrl?: string;
  /** Injected by tests; defaults to the global fetch. */
  fetch?: LemonSqueezyFetch;
};

/**
 * The client shape we use; tests can inject a fake implementation.
 *
 * It only exposes `request`: the adapter parses the JSON:API object structure (parseEvent is a pure
 * function, and with a fake fetch tests can assert on both the request body and the response
 * parsing), so the client is only responsible for the auth header, the media type, and throwing on
 * errors.
 */
export type LemonSqueezyClient = {
  request(method: string, path: string, body?: unknown): Promise<unknown>;
};

/**
 * Creates the client.
 *
 * **No retries, not even on 429**: checkout is triggered by a user click (letting the user retry
 * on failure is the most direct option), and Lemon Squeezy redelivers webhooks with its own
 * backoff. Adding another retry layer here would only drag out requests and could create duplicate
 * orders.
 */
export function createLemonSqueezyClient({
  apiKey,
  baseUrl = LEMONSQUEEZY_API_BASE_URL,
  fetch: fetchImpl = fetch,
}: LemonSqueezyClientOptions): LemonSqueezyClient {
  return {
    async request(method: string, path: string, body?: unknown) {
      const response = await fetchImpl(new URL(path, baseUrl), {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: JSON_API_MEDIA_TYPE,
          ...(body !== undefined && { "Content-Type": JSON_API_MEDIA_TYPE }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new LemonSqueezyApiError(
          response.status,
          text.slice(0, ERROR_BODY_LIMIT),
        );
      }
      return text ? JSON.parse(text) : {};
    },
  };
}
