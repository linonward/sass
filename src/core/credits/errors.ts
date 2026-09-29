/**
 * Insufficient balance: the deduction or negative adjustment did not take effect; neither the balance
 * nor the ledger changed.
 */
export class InsufficientCreditsError extends Error {
  constructor(
    readonly userId: string,
    readonly requested: number,
  ) {
    super(`Insufficient credits: user ${userId} needs ${requested}`);
    this.name = "InsufficientCreditsError";
  }
}

/** A credits API was called while `features.credits` is off. */
export class CreditsDisabledError extends Error {
  constructor() {
    super("Credits are disabled (features.credits is false)");
    this.name = "CreditsDisabledError";
  }
}

/** A refund could not find the matching deduction transaction. */
export class CreditTransactionNotFoundError extends Error {
  constructor(
    readonly source: string,
    readonly sourceId: string,
  ) {
    super(`No deduction found for ${source}:${sourceId}`);
    this.name = "CreditTransactionNotFoundError";
  }
}
