import { getDb } from "@/core/db";

import siteConfig from "../../../site.config";
import { createCredits } from "./service";

export * from "./errors";
export type {
  AdjustInput,
  CreditTransaction,
  Credits,
  DeductInput,
  Executor,
  GrantInput,
  RefundInput,
  WriteResult,
} from "./service";

/** `features.credits` 是否开启。关闭时下面的 API 都会抛出 CreditsDisabledError，调用方应先判断。 */
export const creditsEnabled = siteConfig.features.credits;

/** 绑定全局数据库和站点配置的积分服务。 */
export const {
  getBalance,
  grantCredits,
  deductCredits,
  refundCredits,
  adjustCredits,
  listTransactions,
} = createCredits({ db: getDb, enabled: creditsEnabled });
