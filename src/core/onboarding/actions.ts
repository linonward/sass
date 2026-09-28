"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { SIGN_IN_PATH } from "@/core/auth/routes";
import { auth } from "@/core/auth/server";
import { db } from "@/core/db";
import { user as userTable } from "@/core/db/schema";
import { localizedPath } from "@/core/seo/urls";

export type CompleteState = { status: "idle" } | { status: "success" };

/**
 * 标记首次运行引导已完成：之后登录不再自动落到 /onboarding，页面本身还能从菜单进。
 *
 * 只写这一个布尔值 —— 每一步是否做过由页面现算（见 steps.ts），存下来只会两处打架。
 * 幂等：重复点、两个标签页同时点都只是再写一次 true。
 */
export async function completeOnboarding(
  locale: string,
  _prev: CompleteState,
  _form: FormData,
): Promise<CompleteState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(localizedPath(locale, SIGN_IN_PATH));
  await db
    .update(userTable)
    .set({ onboardingCompleted: true })
    .where(eq(userTable.id, session.user.id));
  return { status: "success" };
}
