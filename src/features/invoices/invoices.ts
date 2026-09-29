import { z } from "zod";

import { invoiceStatuses } from "./schema";

// Example business module: amount parsing and form validation. No Next / database imports here —
// pure logic keeps it unit-testable. Database reads are in ./queries.ts, writes in ./actions.ts.

export const CUSTOMER_NAME_MAX = 120;

/**
 * Maximum amount (in minor currency units): 100 million cents = 1 million, blocking input that
 * would overflow the integer column.
 */
export const AMOUNT_MAX_CENTS = 100_000_000;

/**
 * A human-entered amount → an integer in minor currency units (cents).
 *
 * Accepts `1250`, `1250.5`, `1,250.00`; rejects negatives, 0, more than two decimal places and
 * any other character. Returns null when it can't parse (the caller turns that into a form error)
 * rather than throwing — user input shouldn't make the server 500. Cents are computed by string
 * concatenation, not floating-point `Number(x) * 100` (`19.99 * 100` is 1998.9999…).
 */
export function parseAmountToCents(value: unknown): number | null {
  if (typeof value !== "string") return null;
  // Thousands separators are only for humans, so strip them first; any other character is rejected.
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim().replace(/,/g, ""));
  if (!match) return null;
  const cents =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return cents > 0 && cents <= AMOUNT_MAX_CENTS ? cents : null;
}

/**
 * Minor currency units → the amount text in the form (editing needs to prefill an editable value
 * like `1250.00`).
 */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Validation for the create/edit form. One schema for the three fields, shared by create and
 * update — with a copy in each, sooner or later one would accept an empty customer name and the
 * other wouldn't.
 */
export const invoiceFormSchema = z.object({
  customerName: z.string().trim().min(1).max(CUSTOMER_NAME_MAX),
  // The form sends a string; once validated it's cents.
  amount: z.unknown().transform((value, ctx) => {
    const cents = parseAmountToCents(value);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: "invalid_amount" });
      return z.NEVER;
    }
    return cents;
  }),
  status: z.enum(invoiceStatuses),
});

export type InvoiceInput = z.infer<typeof invoiceFormSchema>;

/**
 * Parse the form. On failure it returns just a flag: which field is wrong is left to the client's
 * native validation and hints.
 */
export function parseInvoiceForm(form: FormData) {
  const parsed = invoiceFormSchema.safeParse({
    customerName: form.get("customerName"),
    amount: form.get("amount"),
    status: form.get("status"),
  });
  return parsed.success
    ? ({ ok: true, data: parsed.data } as const)
    : ({ ok: false } as const);
}
