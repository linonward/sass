import { createHash, randomBytes } from "node:crypto";

/** Plaintext prefix. Plaintext looks like `sk_` + 64 hex chars. */
export const API_KEY_PREFIX = "sk_";

// Random part: 32 bytes = 256 bits of entropy, 64 characters in hex.
const SECRET_BYTES = 32;
// Extra plaintext characters kept in `prefix` (after `sk_`). Enough to recognize the key in a
// list, not enough to recover the full plaintext.
const PREFIX_CHARS = 8;

const KEY_PATTERN = /^sk_[0-9a-f]{64}$/;

export type GeneratedApiKey = {
  /** One-time plaintext, returned to the user only at creation; never stored. */
  plaintext: string;
  /** Displayable prefix of the plaintext (`sk_` + 8 chars), for recognizing it in lists. */
  prefix: string;
  /** SHA-256 of the plaintext (hex); authentication looks it up by this. */
  hashedKey: string;
};

/**
 * Hashes the plaintext. SHA-256 rather than a password hash: the plaintext is a 256-bit random
 * value with no dictionary to guess from, so a slow hash buys nothing; authentication runs on every
 * request, so a slow hash would only slow the API down.
 */
export function hashApiKey(plaintext: string) {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** Generates a key: random plaintext + display prefix + hash to store. */
export function generateApiKey(): GeneratedApiKey {
  const plaintext = `${API_KEY_PREFIX}${randomBytes(SECRET_BYTES).toString("hex")}`;
  return {
    plaintext,
    prefix: plaintext.slice(0, API_KEY_PREFIX.length + PREFIX_CHARS),
    hashedKey: hashApiKey(plaintext),
  };
}

/**
 * Whether the value has the format this kit issues. Wrong format means no database lookup; it's
 * simply invalid.
 */
export function isApiKeyFormat(value: string) {
  return KEY_PATTERN.test(value);
}
