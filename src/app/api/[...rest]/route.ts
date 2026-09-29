/**
 * Unmatched paths under /api: return a machine-readable JSON 404.
 *
 * Without this file these requests are swallowed by the [locale] dynamic segment (the locale of
 * `/api/nope` is "api") and end up on the HTML 404 page — an API caller gets a whole HTML page.
 * This gives the API prefix an explicit JSON shape, matching the `{ error }` convention of
 * src/app/api/**\/route.ts.
 *
 * More specific routes (/api/auth/[...all], /api/billing/status, etc.) still match first.
 * The status code is still a real 404; a JSON response has no <meta name="robots">, so
 * X-Robots-Tag is used instead.
 */

const NOT_FOUND = () =>
  Response.json(
    { error: "not_found" },
    { status: 404, headers: { "X-Robots-Tag": "noindex" } },
  );

export function GET() {
  return NOT_FOUND();
}

export function POST() {
  return NOT_FOUND();
}

export function PUT() {
  return NOT_FOUND();
}

export function PATCH() {
  return NOT_FOUND();
}

export function DELETE() {
  return NOT_FOUND();
}

export function HEAD() {
  return NOT_FOUND();
}
