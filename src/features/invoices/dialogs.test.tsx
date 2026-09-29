import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test, vi } from "vitest";

import en from "../../../messages/en.json";
import { chooseOption, selectedValue } from "@/core/ui/testing";
import {
  CreateInvoiceDialog,
  DeleteInvoiceDialog,
  EditInvoiceDialog,
  type InvoiceDraft,
} from "./dialogs";

// All three dialogs go through Server Actions, which are faked here: this locks down the dialogs'
// own behavior (what the form holds, what success/failure show, when they close); the actions'
// validation is tested in invoices.test.ts and invoices-db.test.ts.

const createInvoice = vi.fn();
const updateInvoice = vi.fn();
const deleteInvoice = vi.fn();
vi.mock("./actions", () => ({
  createInvoice: (...args: unknown[]) => createInvoice(...args),
  updateInvoice: (...args: unknown[]) => updateInvoice(...args),
  deleteInvoice: (...args: unknown[]) => deleteInvoice(...args),
}));

const invoice: InvoiceDraft = {
  id: "6f1c2f52-0f1b-4a2e-9f6d-2f3b1c4d5e6f",
  customerName: "Acme Inc.",
  amount: 125000,
  status: "draft",
};

function renderDialog(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>,
  );
}

/** The three form fields; `submit` is each dialog's submit button. */
function fillCreateForm(submit: string, customer = "Acme Inc.") {
  fireEvent.change(screen.getByLabelText(en.Invoices.form.customerLabel), {
    target: { value: customer },
  });
  fireEvent.change(screen.getByLabelText(en.Invoices.form.amountLabel), {
    target: { value: "1250.00" },
  });
  fireEvent.click(screen.getByTestId(submit));
}

/** Get the FormData the action received (the first argument is the previous state). */
function submittedForm(mock: typeof createInvoice): FormData {
  return mock.mock.calls.at(-1)![1] as FormData;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const mock of [createInvoice, updateInvoice, deleteInvoice]) {
    mock.mockReset();
  }
});

describe("CreateInvoiceDialog", () => {
  test("submits the form's values and swaps to a receipt in place on success", async () => {
    createInvoice.mockResolvedValue({ status: "success" });
    renderDialog(<CreateInvoiceDialog currency="USD" />);

    fireEvent.click(screen.getByTestId("invoice-create"));
    fillCreateForm("invoice-create-submit");

    await waitFor(() =>
      expect(screen.getByText(en.Invoices.create.createdTitle)).toBeDefined(),
    );
    expect(Object.fromEntries(submittedForm(createInvoice))).toEqual({
      customerName: "Acme Inc.",
      amount: "1250.00",
      status: "draft",
    });
    // The receipt isn't a form: there's no button to submit again.
    expect(screen.queryByTestId("invoice-create-submit")).toBeNull();
  });

  test("on failure the form stays and the error stays in view", async () => {
    createInvoice.mockResolvedValue({ status: "error", error: "invalid" });
    renderDialog(<CreateInvoiceDialog currency="USD" />);

    fireEvent.click(screen.getByTestId("invoice-create"));
    fillCreateForm("invoice-create-submit");

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        en.Invoices.errors.invalid,
      ),
    );
    expect(screen.getByTestId("invoice-create-submit")).toBeDefined();
    // The entered values are still there (submission is handled manually, not useActionState's
    // automatic form): an error shouldn't wipe what the user just typed, so the error message sits
    // alongside it explaining what's wrong.
    expect(
      (screen.getByLabelText(en.Invoices.form.amountLabel) as HTMLInputElement)
        .value,
    ).toBe("1250.00");
  });

  test("close and reopen: no leftover receipt, the form is empty", async () => {
    createInvoice.mockResolvedValue({ status: "success" });
    renderDialog(<CreateInvoiceDialog currency="USD" />);

    fireEvent.click(screen.getByTestId("invoice-create"));
    fillCreateForm("invoice-create-submit");
    await waitFor(() =>
      expect(screen.getByText(en.Invoices.create.createdTitle)).toBeDefined(),
    );

    // "Done" on the receipt closes the dialog; open it again — you see a fresh form, not the last
    // receipt. This locks in that useActionState must live in a subtree rebuilt by key (we hit this
    // in e2e on the second create).
    fireEvent.click(screen.getByText(en.Invoices.create.done));
    await waitFor(() =>
      expect(screen.queryByText(en.Invoices.create.createdTitle)).toBeNull(),
    );
    fireEvent.click(screen.getByTestId("invoice-create"));

    expect(screen.getByTestId("invoice-create-submit")).toBeDefined();
    expect(screen.queryByText(en.Invoices.create.createdTitle)).toBeNull();
    expect(
      (
        screen.getByLabelText(
          en.Invoices.form.customerLabel,
        ) as HTMLInputElement
      ).value,
    ).toBe("");
  });
});

describe("EditInvoiceDialog", () => {
  test("the form carries this row's values and the submit includes the id", async () => {
    updateInvoice.mockResolvedValue({ status: "success" });
    renderDialog(<EditInvoiceDialog invoice={invoice} currency="USD" />);

    fireEvent.click(screen.getByTestId("invoice-edit"));

    // The amount is prefilled as editable text (cents → `1250.00`), and the status is the current one.
    expect(
      (screen.getByLabelText(en.Invoices.form.amountLabel) as HTMLInputElement)
        .value,
    ).toBe("1250.00");
    expect(
      (
        screen.getByLabelText(
          en.Invoices.form.customerLabel,
        ) as HTMLInputElement
      ).value,
    ).toBe("Acme Inc.");
    expect(selectedValue(document.body, "status")).toBe("draft");

    await chooseOption(
      screen.getByLabelText(en.Invoices.form.statusLabel),
      en.Invoices.form.status.paid,
    );
    fireEvent.click(screen.getByTestId("invoice-edit-submit"));

    await waitFor(() =>
      expect(screen.getByText(en.Invoices.edit.savedTitle)).toBeDefined(),
    );
    const form = submittedForm(updateInvoice);
    expect(form.get("id")).toBe(invoice.id);
    expect(form.get("status")).toBe("paid");
  });

  test("not found (cross-user or deleted) shows an error, not saved", async () => {
    updateInvoice.mockResolvedValue({ status: "error", error: "not_found" });
    renderDialog(<EditInvoiceDialog invoice={invoice} currency="USD" />);

    fireEvent.click(screen.getByTestId("invoice-edit"));
    fireEvent.click(screen.getByTestId("invoice-edit-submit"));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        en.Invoices.errors.not_found,
      ),
    );
    expect(screen.queryByText(en.Invoices.edit.savedTitle)).toBeNull();
  });

  test("close and reopen: back to the form with current values, not the last receipt", async () => {
    updateInvoice.mockResolvedValue({ status: "success" });
    renderDialog(<EditInvoiceDialog invoice={invoice} currency="USD" />);

    fireEvent.click(screen.getByTestId("invoice-edit"));
    fireEvent.click(screen.getByTestId("invoice-edit-submit"));
    await waitFor(() =>
      expect(screen.getByText(en.Invoices.edit.savedTitle)).toBeDefined(),
    );

    fireEvent.click(screen.getByText(en.Invoices.edit.done));
    await waitFor(() =>
      expect(screen.queryByText(en.Invoices.edit.savedTitle)).toBeNull(),
    );
    fireEvent.click(screen.getByTestId("invoice-edit"));

    expect(screen.getByTestId("invoice-edit-submit")).toBeDefined();
    expect(
      (screen.getByLabelText(en.Invoices.form.amountLabel) as HTMLInputElement)
        .value,
    ).toBe("1250.00");
  });
});

describe("DeleteInvoiceDialog", () => {
  test("the dialog closes after confirming delete", async () => {
    deleteInvoice.mockResolvedValue({ status: "success" });
    renderDialog(<DeleteInvoiceDialog invoice={invoice} />);

    fireEvent.click(screen.getByTestId("invoice-delete"));
    fireEvent.click(screen.getByTestId("invoice-delete-confirm"));

    await waitFor(() =>
      expect(screen.queryByTestId("invoice-delete-confirm")).toBeNull(),
    );
    expect(submittedForm(deleteInvoice).get("id")).toBe(invoice.id);
  });

  test("when delete fails the dialog stays open and shows the error", async () => {
    deleteInvoice.mockResolvedValue({ status: "error", error: "not_found" });
    renderDialog(<DeleteInvoiceDialog invoice={invoice} />);

    fireEvent.click(screen.getByTestId("invoice-delete"));
    fireEvent.click(screen.getByTestId("invoice-delete-confirm"));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        en.Invoices.errors.not_found,
      ),
    );
    expect(screen.getByTestId("invoice-delete-confirm")).toBeDefined();
  });

  test("reopening starts clean: no leftover error from last time", async () => {
    deleteInvoice.mockResolvedValue({ status: "error", error: "unavailable" });
    renderDialog(<DeleteInvoiceDialog invoice={invoice} />);

    fireEvent.click(screen.getByTestId("invoice-delete"));
    fireEvent.click(screen.getByTestId("invoice-delete-confirm"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());

    // An alert dialog has no corner close button: Cancel is the way out.
    fireEvent.click(
      screen.getByRole("button", { name: en.Invoices.delete.cancel }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("invoice-delete-confirm")).toBeNull(),
    );

    fireEvent.click(screen.getByTestId("invoice-delete"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
