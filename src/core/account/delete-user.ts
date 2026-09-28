import { eq, like, or } from "drizzle-orm";

import { cooldownIdentifier } from "@/core/auth/cooldown";
import { db } from "@/core/db";
import { user, verification } from "@/core/db/schema";

import "./hooks";
import { runOnUserDelete, type DeletedUser } from "./on-user-delete";

/** 转义 LIKE 的通配符，邮箱里的 `_` 不能匹配任意字符。 */
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * 删除用户及其数据：先执行 onUserDelete 钩子（失败则中止），再在一个事务里删除
 * 该邮箱的验证码与冷却记录和用户本身；session、account 由外键级联删除。
 * 业务表引用 user.id 时应设 `onDelete: "cascade"`，或者注册钩子自行清理。
 *
 * 登录状态这里就结束了：`session.userId` 是 `onDelete: "cascade"`（见
 * src/core/db/schema/auth.ts），删 user 那一行时数据库把 session 一起删掉，
 * 不需要（也不应该）先手动删 session —— 事务里多一条语句就多一个中途失败的机会。
 * 浏览器里的登录 cookie 由调用方清（src/core/account/actions.ts 的 deleteAccount）。
 */
export async function deleteUserAccount({ userId, email }: DeletedUser) {
  await runOnUserDelete({ userId, email });

  const normalized = email.trim().toLowerCase();
  await db.transaction(async (tx) => {
    await tx.delete(verification).where(
      or(
        // emailOTP 插件的记录：`<type>-otp-<email>`。
        like(verification.identifier, `%-otp-${escapeLike(normalized)}`),
        eq(verification.identifier, cooldownIdentifier(normalized)),
      ),
    );
    await tx.delete(user).where(eq(user.id, userId));
  });
}
