import { describe, expect, test } from "vitest";

import {
  AMOUNT_MAX_CENTS,
  CUSTOMER_NAME_MAX,
  centsToInput,
  parseAmountToCents,
  parseInvoiceForm,
} from "./invoices";

// Pure logic of the example module: amount parsing + form validation. Both dialogs and the Server
// Actions go through it, so with this layer locked down, other layers needn't retest bad input.

describe("parseAmountToCents", () => {
  test.each([
    ["1250", 125000],
    ["1250.5", 125050],
    ["1250.05", 125005],
    // Thousands separators are for humans; just strip them.
    ["1,250.00", 125000],
    [" 19.99 ", 1999],
    ["0.01", 1],
    // Exactly the maximum is accepted; one cent more is rejected (the integer column can't hold it,
    // and nobody should be entering it).
    ["1000000", AMOUNT_MAX_CENTS],
  ])("%s → %s cents", (value, cents) => {
    expect(parseAmountToCents(value)).toBe(cents);
  });

  test.each([
    ["", "empty"],
    ["0", "zero"],
    ["0.00", "zero"],
    ["-1", "negative"],
    ["19.999", "three decimal places"],
    ["1.2.3", "two decimal points"],
    ["1e3", "scientific notation"],
    ["１２３", "full-width digits"],
    ["12 34", "space in the middle"],
    ["1000000.01", "over the maximum"],
  ])("%s → null (%s)", (value) => {
    expect(parseAmountToCents(value)).toBeNull();
  });

  test.each([null, undefined, 1250, {}, [], true])(
    "non-string %o → null, without throwing",
    (value) => {
      expect(parseAmountToCents(value)).toBeNull();
    },
  );

  test("no floating-point multiplication: 19.99 is 1999 cents, not 1998.99…", () => {
    expect(parseAmountToCents("19.99")).toBe(1999);
    expect(Number("19.99") * 100).not.toBe(1999);
  });
});

describe("centsToInput", () => {
  test.each([
    [125000, "1250.00"],
    [1999, "19.99"],
    [1, "0.01"],
    [0, "0.00"],
  ])("%s cents → %s", (cents, text) => {
    expect(centsToInput(cents)).toBe(text);
  });

  test("a prefilled value always parses back to the same number (edit → save must not change the amount)", () => {
    for (const cents of [1, 1999, 125000, AMOUNT_MAX_CENTS]) {
      expect(parseAmountToCents(centsToInput(cents))).toBe(cents);
    }
  });
});

/** Build form data; a field passed as undefined is left empty. */
function form(fields: Record<string, string | undefined>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) data.set(key, value);
  }
  return data;
}

const valid = {
  customerName: "Acme Inc.",
  amount: "1250.00",
  status: "draft",
};

describe("parseInvoiceForm", () => {
  test("valid form: customer name is trimmed and the amount converted to cents", () => {
    expect(
      parseInvoiceForm(form({ ...valid, customerName: "  Acme Inc.  " })),
    ).toEqual({
      ok: true,
      data: { customerName: "Acme Inc.", amount: 125000, status: "draft" },
    });
  });

  test.each([
    ["empty customer name", { ...valid, customerName: "   " }],
    [
      "customer name too long",
      { ...valid, customerName: "A".repeat(CUSTOMER_NAME_MAX + 1) },
    ],
    ["missing customer name", { ...valid, customerName: undefined }],
    ["invalid amount", { ...valid, amount: "0" }],
    ["missing amount", { ...valid, amount: undefined }],
    ["status not in the enum", { ...valid, status: "cancelled" }],
    ["missing status", { ...valid, status: undefined }],
  ])("%s → rejected", (_name, fields) => {
    expect(parseInvoiceForm(form(fields))).toEqual({ ok: false });
  });

  test("customer name exactly at the limit", () => {
    const parsed = parseInvoiceForm(
      form({ ...valid, customerName: "A".repeat(CUSTOMER_NAME_MAX) }),
    );
    expect(parsed.ok).toBe(true);
  });
});
