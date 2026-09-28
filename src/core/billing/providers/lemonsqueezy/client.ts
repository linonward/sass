/**
 * Lemon Squeezy API 的薄封装。
 *
 * 刻意不引 `@lemonsqueezy/lemonsqueezy.js`：SDK 最后一版是 2024-11-05，仓库此后没有推送，
 * 而它本身只是对 fetch 的一层包装（加几个类型定义）。手写这几行换来的是：依赖面只有官方的
 * HTTP 接口一处（不碰 package.json / pnpm-lock.yaml / THIRD-PARTY-NOTICES.md），而且能直接
 * 注入假 fetch 做单测。官方对 API 没有落日计划，接口形状见 https://docs.lemonsqueezy.com/api。
 */

export const LEMONSQUEEZY_API_BASE_URL = "https://api.lemonsqueezy.com";
export const LEMONSQUEEZY_PROVIDER_ID = "lemonsqueezy";

/** JSON:API 的媒体类型；Accept 和 Content-Type 都要带上，否则服务端按普通 JSON 处理。 */
const JSON_API_MEDIA_TYPE = "application/vnd.api+json";

/** 响应体截断长度：错误信息要能看出原因，又不至于把整页 HTML 写进日志。 */
const ERROR_BODY_LIMIT = 500;

/** 非 2xx 响应。带状态码和响应体片段，调用方按状态码判断（例如取消订阅的 404 视为成功）。 */
export class LemonSqueezyApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Lemon Squeezy API responded ${status}: ${body}`);
    this.name = "LemonSqueezyApiError";
  }
}

/** injectable fetch：测试注入假实现，生产用全局 fetch。 */
export type LemonSqueezyFetch = typeof fetch;

export type LemonSqueezyClientOptions = {
  apiKey: string;
  baseUrl?: string;
  /** 测试注入；默认用全局 fetch。 */
  fetch?: LemonSqueezyFetch;
};

/**
 * 用到的客户端形状，测试可以注入假的实现。
 *
 * 只暴露一个 `request`：JSON:API 的对象结构由适配器解析（parseEvent 是纯函数，用假 fetch
 * 就能连请求体带响应解析一起断言），客户端负责的只有鉴权头、媒体类型和错误上抛。
 */
export type LemonSqueezyClient = {
  request(method: string, path: string, body?: unknown): Promise<unknown>;
};

/**
 * 创建客户端。
 *
 * **不做重试，429 也不做**：结账是用户点击触发的（失败让用户重试最直接），webhook 由
 * Lemon Squeezy 自己按退避重推，这里再排一层重试只会拉长请求、还可能重复建单。
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
