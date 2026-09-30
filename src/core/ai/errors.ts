// Error codes for the image and video endpoints. Error responses are JSON `{ error }`; the frontend
// shows the copy from Playground.errors for each code.

const knownErrors = [
  "insufficient_credits",
  "rate_limited",
  "unavailable",
  "model_unavailable",
  "storage_unavailable",
  "invalid_model",
  "invalid_prompt",
  "invalid_aspect_ratio",
  "invalid_image",
  "image_not_supported",
  "unauthorized",
  "model_error",
] as const;
type KnownError = (typeof knownErrors)[number];
export type ImageErrorCode = KnownError | "generic";

/**
 * Error responses are JSON `{ error }`; rate limiting returns 429 (the body may not include error).
 */
export async function imageErrorCode(
  response: Response,
): Promise<KnownError | "generic"> {
  if (response.status === 429) return "rate_limited";
  const code = await response
    .json()
    .then((body: { error?: unknown }) => body?.error)
    .catch(() => undefined);
  return knownErrors.includes(code as KnownError)
    ? (code as KnownError)
    : "generic";
}
