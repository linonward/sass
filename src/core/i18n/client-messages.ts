import type { AbstractIntlMessages } from "next-intl";

/**
 * 客户端组件（"use client"）用到的文案命名空间。只把这些发给浏览器：
 * 其余命名空间（Email、Landing、Blog 等）只在服务端渲染，不必进 HTML 和 RSC payload。
 * 新的客户端组件用了别的命名空间时加到这里；client-messages.test.ts 会检查有没有漏。
 */
export const clientNamespaces = [
  "Account",
  "Admin",
  "Auth",
  "Billing",
  "Dashboard",
  "Error",
  "Example",
  "Header",
  "Locale",
  "Playground",
  "Theme",
] as const;

/** 从完整文案里取出客户端需要的部分，传给 NextIntlClientProvider。 */
export function pickClientMessages(
  messages: AbstractIntlMessages,
): AbstractIntlMessages {
  return Object.fromEntries(
    clientNamespaces
      .filter((namespace) => namespace in messages)
      .map((namespace) => [namespace, messages[namespace]!]),
  );
}
