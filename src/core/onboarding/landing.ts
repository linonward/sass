/** 首次运行引导页（不含语言前缀）。 */
export const ONBOARDING_PATH = "/onboarding";

/**
 * 登录成功后的落点。
 *
 * 规则（顺序即优先级）：
 * 1. 这次登录带了 `callbackURL`（受保护页面的回跳、邀请链接）→ 一律尊重原目标：
 *    深链比引导重要，`onboardingPath` 传 null 就表示这种情况。
 * 2. 用户还没走完清单（`onboardingCompleted === false`）→ 引导页。
 * 3. 其余情况（已完成、或读不到这个字段）→ 原目标。
 *
 * 已完成的用户拿到的是和以前逐字节相同的跳转：一次跳转、一次加载，不闪。
 * 字段读不到时也按「已完成」处理 —— 宁可少引导一次，也不要把已经做完的人反复丢回引导页。
 *
 * `user` 是 better-auth 返回的用户对象；客户端没有开 `inferAdditionalFields`，
 * 所以这里自己窄化，不依赖它的类型。
 */
export function resolvePostSignInPath(input: {
  /** 已经清洗过的站内目标（含语言前缀）。 */
  callbackURL: string;
  /** 这次的引导页地址；带了 callbackURL 的登录传 null。 */
  onboardingPath: string | null;
  user: unknown;
}): string {
  if (!input.onboardingPath) return input.callbackURL;
  return onboardingCompleted(input.user) === false
    ? input.onboardingPath
    : input.callbackURL;
}

/** 用户对象上的 onboardingCompleted：不是布尔就当作「不知道」。 */
function onboardingCompleted(user: unknown): boolean | undefined {
  if (typeof user !== "object" || user === null) return undefined;
  const value = (user as { onboardingCompleted?: unknown }).onboardingCompleted;
  return typeof value === "boolean" ? value : undefined;
}
