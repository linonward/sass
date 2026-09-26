/**
 * /api 下未匹配的路径：返回机器可读的 JSON 404。
 *
 * 没有这个文件时，这些请求会被 [locale] 动态段吞掉（`/api/nope` 的 locale 是
 * "api"），最终落到 HTML 的 404 页 —— 调 API 的人拿到一整页 HTML。给 API 前缀
 * 一个明确的 JSON 形态，和 src/app/api/**\/route.ts 的 `{ error }` 约定一致。
 *
 * 更具体的路由（/api/auth/[...all]、/api/billing/status 等）仍然优先匹配。
 * 状态码仍是真 404；JSON 响应里没有 <meta name="robots">，用 X-Robots-Tag 代替。
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
