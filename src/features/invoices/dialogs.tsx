"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition, type FormEvent } from "react";

import { Button } from "@/core/ui/button";
import { ConfirmActionDialog } from "@/core/ui/confirm-action-dialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/core/ui/dialog";
import { Input } from "@/core/ui/input";
import { FormField } from "@/core/ui/form-field";
import { FormMessage } from "@/core/ui/form-message";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/select";
import { SubmitButton } from "@/core/ui/submit-button";

import {
  createInvoice,
  deleteInvoice,
  updateInvoice,
  type InvoiceActionState,
} from "./actions";
import { CUSTOMER_NAME_MAX, centsToInput } from "./invoices";
import { invoiceStatuses, type InvoiceStatus } from "./schema";

// The example feature's three dialogs: create, edit and delete.
//
// Create and edit submit themselves (startTransition + setState): on success the
// dialog swaps to a receipt in place, and closing clears it. They go through
// onSubmit, not `<form action={fn}>`: React resets every uncontrolled field after
// a function action, which wiped what the user typed whenever the server
// rejected it. Delete is a plain ConfirmActionDialog.

const idle: InvoiceActionState = { status: "idle" };

export type InvoiceDraft = {
  id: string;
  customerName: string;
  amount: number;
  status: InvoiceStatus;
};

/** The action's error, from `Invoices.errors` by code. */
function useErrorMessage(state: InvoiceActionState) {
  const t = useTranslations("Invoices.errors");
  return state.status === "error" ? t(state.error) : undefined;
}

/** The three fields both forms share. FormField links each label, hint and control. */
function InvoiceFields({
  currency,
  invoice,
}: {
  currency: string;
  invoice?: InvoiceDraft;
}) {
  const t = useTranslations("Invoices.form");
  return (
    <>
      <FormField label={t("customerLabel")}>
        <Input
          name="customerName"
          required
          maxLength={CUSTOMER_NAME_MAX}
          defaultValue={invoice?.customerName}
          placeholder={t("customerPlaceholder")}
        />
      </FormField>
      <FormField
        label={t("amountLabel")}
        description={t("amountHint", { currency })}
      >
        <Input
          name="amount"
          required
          inputMode="decimal"
          autoComplete="off"
          defaultValue={invoice ? centsToInput(invoice.amount) : undefined}
          placeholder={t("amountPlaceholder")}
        />
      </FormField>
      <FormField label={t("statusLabel")} labelFor="button">
        <Select
          name="status"
          defaultValue={invoice?.status ?? "draft"}
          items={invoiceStatuses.map((status) => ({
            value: status,
            label: t(`status.${status}`),
          }))}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {invoiceStatuses.map((status) => (
              <SelectItem key={status} value={status}>
                {t(`status.${status}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
    </>
  );
}

/**
 * Create an invoice. On success the dialog swaps to a receipt; close it and the new row is in the
 * list.
 */
export function CreateInvoiceDialog({ currency }: { currency: string }) {
  const t = useTranslations("Invoices.create");
  const tc = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<InvoiceActionState>(idle);
  const error = useErrorMessage(state);
  const [pending, startTransition] = useTransition();

  // State lives in the component and is cleared on close: reopening shows a blank form, not the last
  // receipt. Not useActionState's automatic form — its state can't be reset manually, only by
  // remounting with a key, and remounting interrupts the close animation, leaving the overlay on the
  // page blocking clicks (we hit this in e2e).
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => setState(await createInvoice(state, form)));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setState(idle);
      }}
    >
      <DialogTrigger
        render={
          <Button data-testid="invoice-create" className="max-sm:w-full" />
        }
      >
        {t("open")}
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        {state.status === "success" ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("createdTitle")}</DialogTitle>
              <DialogDescription>{t("createdDescription")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button type="button" />}>
                {t("done")}
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription>{t("description")}</DialogDescription>
            </DialogHeader>
            <InvoiceFields currency={currency} />
            <FormMessage error={error} />
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                {t("cancel")}
              </DialogClose>
              <SubmitButton
                pending={pending}
                pendingLabel={t("creating")}
                data-testid="invoice-create-submit"
              >
                {t("submit")}
              </SubmitButton>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Edit a row. The form starts with this row's values. */
export function EditInvoiceDialog({
  invoice,
  currency,
}: {
  invoice: InvoiceDraft;
  currency: string;
}) {
  const t = useTranslations("Invoices.edit");
  const tc = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<InvoiceActionState>(idle);
  const error = useErrorMessage(state);
  const [pending, startTransition] = useTransition();

  // Same as create: clear state on close, so reopening returns to the form with the current values
  // instead of sticking on the last receipt.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => setState(await updateInvoice(state, form)));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setState(idle);
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" data-testid="invoice-edit" />
        }
      >
        {t("open")}
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        {state.status === "success" ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("savedTitle")}</DialogTitle>
              <DialogDescription>{t("savedDescription")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button type="button" />}>
                {t("done")}
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <input type="hidden" name="id" value={invoice.id} />
            <DialogHeader>
              <DialogTitle>
                {t("title", { name: invoice.customerName })}
              </DialogTitle>
              <DialogDescription>{t("description")}</DialogDescription>
            </DialogHeader>
            <InvoiceFields currency={currency} invoice={invoice} />
            <FormMessage error={error} />
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                {t("cancel")}
              </DialogClose>
              <SubmitButton
                pending={pending}
                pendingLabel={t("saving")}
                data-testid="invoice-edit-submit"
              >
                {t("submit")}
              </SubmitButton>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Delete confirmation. Deletion is irreversible: nothing is deleted until confirm is clicked, and a
 * failure keeps the error in front of the user.
 */
export function DeleteInvoiceDialog({ invoice }: { invoice: InvoiceDraft }) {
  const t = useTranslations("Invoices.delete");
  const te = useTranslations("Invoices.errors");

  return (
    <ConfirmActionDialog
      trigger={
        <Button variant="outline" size="sm" data-testid="invoice-delete">
          {t("open")}
        </Button>
      }
      title={t("title", { name: invoice.customerName })}
      description={t("description")}
      tone="destructive"
      fields={{ id: invoice.id }}
      confirmLabel={t("confirm")}
      pendingLabel={t("deleting")}
      cancelLabel={t("cancel")}
      confirmTestId="invoice-delete-confirm"
      action={(form) => deleteInvoice(idle, form)}
      errorMessage={(error) => te(error)}
    />
  );
}
