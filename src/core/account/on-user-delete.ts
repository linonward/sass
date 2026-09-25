import { logger } from "@/core/observability/logger";

/** 删除账户时传给各个钩子的用户信息。 */
export type DeletedUser = { userId: string; email: string };

export type OnUserDeleteHandler = (user: DeletedUser) => Promise<void> | void;

const handlers = new Map<string, OnUserDeleteHandler>();

/**
 * 注册删除账户前要执行的清理逻辑，比如取消订阅、删除上传的文件。
 * 按注册顺序执行；同名重复注册会覆盖前一个（模块热更新时不会重复执行）。
 * 在 ./hooks.ts 里 import 注册文件，保证删除时所有模块都已注册。
 */
export function registerOnUserDelete(
  name: string,
  handler: OnUserDeleteHandler,
) {
  handlers.delete(name);
  handlers.set(name, handler);
}

/** 已注册的钩子名称，按执行顺序。 */
export function onUserDeleteHandlers(): string[] {
  return [...handlers.keys()];
}

/** 仅供测试：清空注册表。 */
export function resetOnUserDelete() {
  handlers.clear();
}

/** 某个钩子失败时抛出；删除随之中止，用户数据保持不变。 */
export class OnUserDeleteError extends Error {
  constructor(
    readonly handler: string,
    readonly cause: unknown,
  ) {
    super(`onUserDelete handler "${handler}" failed`);
    this.name = "OnUserDeleteError";
  }
}

/**
 * 依次执行所有钩子。任何一个失败就停止，后面的钩子不再执行，并抛出 OnUserDeleteError。
 * 在删除用户之前调用：钩子还能读到用户数据；外部资源（如订阅）没清理干净时不删除账户，
 * 避免用户被删了却还在扣费。
 */
export async function runOnUserDelete(user: DeletedUser) {
  for (const [name, handler] of handlers) {
    try {
      await handler(user);
    } catch (error) {
      logger.error("account.on_user_delete_failed", {
        error,
        handler: name,
        userId: user.userId,
      });
      throw new OnUserDeleteError(name, error);
    }
  }
}
