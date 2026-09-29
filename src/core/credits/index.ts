import { getDb } from "@/core/db";
import { sendEmail } from "@/core/email/send";

import siteConfig from "../../../site.config";
import { createLowBalanceHook } from "./low-balance";
import { createCredits } from "./service";

export * from "./errors";
export type {
  AdjustInput,
  AfterCommitCallback,
  CreditTransaction,
  Credits,
  DeductInput,
  Executor,
  GrantInput,
  ReclaimInput,
  ReclaimResult,
  RefundInput,
  WriteOptions,
  WriteResult,
} from "./service";

/**
 * Whether `features.credits` is on. When it is off, every API below throws CreditsDisabledError, so
 * callers should check this first.
 */
export const creditsEnabled = siteConfig.features.credits;

/** The credits service bound to the global database and the site config. */
export const {
  getBalance,
  grantCredits,
  deductCredits,
  reclaimCredits,
  refundCredits,
  adjustCredits,
  listTransactions,
} = createCredits({
  db: getDb,
  enabled: creditsEnabled,
  // When the balance drops below credits.lowBalanceThreshold, send the credits-low email (at most
  // one per 24 hours).
  lowBalance: createLowBalanceHook({
    threshold: siteConfig.credits.lowBalanceThreshold,
    send: sendEmail,
  }),
});
