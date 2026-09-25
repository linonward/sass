import type { DbTransaction } from "@/core/db";

import type { BillingEvent } from "./events";

export type BillingEventContext = {
  /** 处理这个事件的事务。钩子里的写库操作都要用它，和事件处理一起提交或回滚。 */
  tx: DbTransaction;
  /**
   * 事件到达时已有更新的状态（乱序到达的旧事件），订阅和订单没有被它改动。
   * 事件本身仍然是真实发生过的，例如迟到的续费仍应发放积分，由钩子按需判断。
   */
  stale: boolean;
  /** 解析出的用户 ID。 */
  userId: string;
};

export type OnBillingEventHandler = (
  event: BillingEvent,
  context: BillingEventContext,
) => Promise<void> | void;

const handlers = new Map<string, OnBillingEventHandler>();

/**
 * 注册账单事件的后续处理，例如发放积分、发送付款成功邮件。
 * 每个事件只触发一次（重复推送不会再次触发），按注册顺序执行；同名重复注册会覆盖前一个。
 * 在 ./hooks.ts 里 import 注册文件，保证处理事件时所有模块都已注册。
 */
export function registerOnBillingEvent(
  name: string,
  handler: OnBillingEventHandler,
) {
  handlers.delete(name);
  handlers.set(name, handler);
}

/** 已注册的钩子名称，按执行顺序。 */
export function onBillingEventHandlers(): string[] {
  return [...handlers.keys()];
}

/** 仅供测试：清空注册表。 */
export function resetOnBillingEvent() {
  handlers.clear();
}

/** 某个钩子失败时抛出；整个事件的事务随之回滚，webhook 返回 500 由服务商重试。 */
export class OnBillingEventError extends Error {
  constructor(
    readonly handler: string,
    readonly cause: unknown,
  ) {
    super(`onBillingEvent handler "${handler}" failed`);
    this.name = "OnBillingEventError";
  }
}

/** 在事件的事务内依次执行所有钩子；任何一个失败就停止并抛出 OnBillingEventError。 */
export async function runOnBillingEvent(
  event: BillingEvent,
  context: BillingEventContext,
) {
  for (const [name, handler] of handlers) {
    try {
      await handler(event, context);
    } catch (error) {
      console.error(`[billing] onBillingEvent "${name}" failed`, error);
      throw new OnBillingEventError(name, error);
    }
  }
}
