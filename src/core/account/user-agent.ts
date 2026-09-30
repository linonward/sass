/**
 * A rough "browser on OS" for the signed-in devices list. It only has to tell a user's own devices
 * apart, so it recognizes the common browsers and systems and nothing more; anything else falls
 * back to a shortened raw string. Order matters: Edge and Opera also say "Chrome", Chrome also says
 * "Safari", and iPadOS/Android also say "Mac"/"Linux".
 */
export type DeviceLabel =
  | { kind: "known"; browser?: string; os?: string }
  | { kind: "raw"; text: string }
  | { kind: "unknown" };

const RAW_MAX = 48;

const BROWSERS: [RegExp, string][] = [
  [/\bEdgA?\//, "Edge"],
  [/\b(OPR|Opera)\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(Firefox|FxiOS)\//, "Firefox"],
  [/\b(Chrome|CriOS)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/\b(iPhone|iPad|iPod)\b/, "iOS"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

const match = (value: string, table: [RegExp, string][]) =>
  table.find(([pattern]) => pattern.test(value))?.[1];

export function describeUserAgent(
  userAgent: string | null | undefined,
): DeviceLabel {
  const value = userAgent?.trim();
  if (!value) return { kind: "unknown" };
  const browser = match(value, BROWSERS);
  const os = match(value, SYSTEMS);
  if (browser || os) return { kind: "known", browser, os };
  return {
    kind: "raw",
    text: value.length > RAW_MAX ? `${value.slice(0, RAW_MAX - 1)}…` : value,
  };
}
