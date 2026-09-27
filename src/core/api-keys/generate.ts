import { createHash, randomBytes } from "node:crypto";

/** 明文前缀。明文形如 `sk_` + 64 位 hex。 */
export const API_KEY_PREFIX = "sk_";

// 随机部分：32 字节 = 256 位熵，hex 展开成 64 个字符。
const SECRET_BYTES = 32;
// `prefix` 里额外保留的明文字符数（`sk_` 之后）。够在列表里认出是哪把 key，
// 又不足以反推完整明文。
const PREFIX_CHARS = 8;

const KEY_PATTERN = /^sk_[0-9a-f]{64}$/;

export type GeneratedApiKey = {
  /** 一次性明文，只在创建时返回给用户；库里不存。 */
  plaintext: string;
  /** 明文的可展示前缀（`sk_` + 8 位），用于列表里辨认。 */
  prefix: string;
  /** 明文的 SHA-256（hex），鉴权按它查库。 */
  hashedKey: string;
};

/**
 * 明文哈希。用 SHA-256 而不是 password 哈希：明文是 256 位随机值，没有字典可猜，
 * 也不需要慢哈希；鉴权在每次请求上，慢哈希反而拖慢接口。
 */
export function hashApiKey(plaintext: string) {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** 新建一把 key：随机明文 + 展示用前缀 + 入库用的哈希。 */
export function generateApiKey(): GeneratedApiKey {
  const plaintext = `${API_KEY_PREFIX}${randomBytes(SECRET_BYTES).toString("hex")}`;
  return {
    plaintext,
    prefix: plaintext.slice(0, API_KEY_PREFIX.length + PREFIX_CHARS),
    hashedKey: hashApiKey(plaintext),
  };
}

/** 是否是本套件签发的格式。格式不对就不必查库，直接按无效处理。 */
export function isApiKeyFormat(value: string) {
  return KEY_PATTERN.test(value);
}
