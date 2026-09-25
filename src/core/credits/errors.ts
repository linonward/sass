/** 余额不足：扣减或负向调整没有生效，余额和流水都未改变。 */
export class InsufficientCreditsError extends Error {
  constructor(
    readonly userId: string,
    readonly requested: number,
  ) {
    super(`Insufficient credits: user ${userId} needs ${requested}`);
    this.name = "InsufficientCreditsError";
  }
}

/** `features.credits` 未开启时调用积分 API。 */
export class CreditsDisabledError extends Error {
  constructor() {
    super("Credits are disabled (features.credits is false)");
    this.name = "CreditsDisabledError";
  }
}

/** 退款时找不到对应的扣减流水。 */
export class CreditTransactionNotFoundError extends Error {
  constructor(
    readonly source: string,
    readonly sourceId: string,
  ) {
    super(`No deduction found for ${source}:${sourceId}`);
    this.name = "CreditTransactionNotFoundError";
  }
}
