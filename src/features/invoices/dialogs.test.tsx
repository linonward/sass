import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test, vi } from "vitest";

import en from "../../../messages/en.json";
import {
  CreateInvoiceDialog,
  DeleteInvoiceDialog,
  EditInvoiceDialog,
  type InvoiceDraft,
} from "./dialogs";

// 三个弹层都走 Server Action，这里把它们换成假实现：锁的是弹层自己的行为
//（表单装什么、成功/失败各显示什么、什么时候关），action 的校验在 invoices.test.ts
// 和 invoices-db.test.ts 里测。

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

/** 表单里的三个字段；`submit` 是各弹层的提交按钮。 */
function fillCreateForm(submit: string, customer = "Acme Inc.") {
  fireEvent.change(screen.getByLabelText(en.Invoices.form.customerLabel), {
    target: { value: customer },
  });
  fireEvent.change(screen.getByLabelText(en.Invoices.form.amountLabel), {
    target: { value: "1250.00" },
  });
  fireEvent.click(screen.getByTestId(submit));
}

/** 取 action 收到的那个 FormData（第一个参数是上一次的状态）。 */
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
  test("提交的是表单里的值，成功后就地换成回执", async () => {
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
    // 回执不是表单：没有可以再提交一次的按钮。
    expect(screen.queryByTestId("invoice-create-submit")).toBeNull();
  });

  test("失败时表单还在，错误留在眼前", async () => {
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
    // 填过的值还在（提交是自己接的，不是 useActionState 的自动形式）：
    // 出错时不该把用户刚敲的东西擦掉，错误文案因此在旁边说明哪里不对。
    expect(
      (screen.getByLabelText(en.Invoices.form.amountLabel) as HTMLInputElement)
        .value,
    ).toBe("1250.00");
  });

  test("关掉再打开：回执不残留，表单是空的", async () => {
    createInvoice.mockResolvedValue({ status: "success" });
    renderDialog(<CreateInvoiceDialog currency="USD" />);

    fireEvent.click(screen.getByTestId("invoice-create"));
    fillCreateForm("invoice-create-submit");
    await waitFor(() =>
      expect(screen.getByText(en.Invoices.create.createdTitle)).toBeDefined(),
    );

    // 回执上的「Done」关掉弹层，再开一次 —— 看到的是新表单，不是上一次的回执。
    // 这条锁的是 useActionState 必须在被 key 重建的子树里（e2e 里第二次新建时踩到过）。
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
  test("表单带出这一行的值，提交带上 id", async () => {
    updateInvoice.mockResolvedValue({ status: "success" });
    renderDialog(<EditInvoiceDialog invoice={invoice} currency="USD" />);

    fireEvent.click(screen.getByTestId("invoice-edit"));

    // 金额回填成可改的文本（分 → `1250.00`），状态是当前那一档。
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
    expect(
      (screen.getByLabelText(en.Invoices.form.statusLabel) as HTMLSelectElement)
        .selectedOptions[0]!.value,
    ).toBe("draft");

    fireEvent.change(screen.getByLabelText(en.Invoices.form.statusLabel), {
      target: { value: "paid" },
    });
    fireEvent.click(screen.getByTestId("invoice-edit-submit"));

    await waitFor(() =>
      expect(screen.getByText(en.Invoices.edit.savedTitle)).toBeDefined(),
    );
    const form = submittedForm(updateInvoice);
    expect(form.get("id")).toBe(invoice.id);
    expect(form.get("status")).toBe("paid");
  });

  test("找不到（越权或已删除）时显示错误、不显示已保存", async () => {
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

  test("关掉再打开：回到带当前值的表单，不是上一次的回执", async () => {
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
  test("确认删除后弹层关上", async () => {
    deleteInvoice.mockResolvedValue({ status: "success" });
    renderDialog(<DeleteInvoiceDialog invoice={invoice} />);

    fireEvent.click(screen.getByTestId("invoice-delete"));
    fireEvent.click(screen.getByTestId("invoice-delete-confirm"));

    await waitFor(() =>
      expect(screen.queryByTestId("invoice-delete-confirm")).toBeNull(),
    );
    expect(submittedForm(deleteInvoice).get("id")).toBe(invoice.id);
  });

  test("删除失败时弹层留着，把错误显示出来", async () => {
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

  test("重新打开是干净状态：上一次的错误不残留", async () => {
    deleteInvoice.mockResolvedValue({ status: "error", error: "unavailable" });
    renderDialog(<DeleteInvoiceDialog invoice={invoice} />);

    fireEvent.click(screen.getByTestId("invoice-delete"));
    fireEvent.click(screen.getByTestId("invoice-delete-confirm"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());

    // 角落那个关闭按钮：可访问名是 sr-only 文本（DialogContent 的 closeLabel）。
    fireEvent.click(screen.getByRole("button", { name: en.Common.close }));
    await waitFor(() =>
      expect(screen.queryByTestId("invoice-delete-confirm")).toBeNull(),
    );

    fireEvent.click(screen.getByTestId("invoice-delete"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
