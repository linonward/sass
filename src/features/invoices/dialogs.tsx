"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button } from "@/core/ui/button";
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
import { Label } from "@/core/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/select";

import {
  createInvoice,
  deleteInvoice,
  updateInvoice,
  type InvoiceActionState,
} from "./actions";
import { CUSTOMER_NAME_MAX, centsToInput } from "./invoices";
import { invoiceStatuses, type InvoiceStatus } from "./schema";

// 示例业务模块的三个弹层：新建、编辑、删除确认。
// 三个都走「提交自己接（startTransition + setState），成功就地换内容、关掉清空状态」——
// 套件自己的弹层就是这么写的（src/core/api-keys/dialogs.tsx 的 RevokeKeyDialog）。

const idle: InvoiceActionState = { status: "idle" };

export type InvoiceDraft = {
  id: string;
  customerName: string;
  amount: number;
  status: InvoiceStatus;
};

/** 表单里的错误提示。文案在 Invoices.errors 下，按 action 返回的 code 取。 */
function FormError({ state }: { state: InvoiceActionState }) {
  const t = useTranslations("Invoices.errors");
  if (state.status !== "error") return null;
  return (
    <p role="alert" className="text-destructive text-sm">
      {t(state.error)}
    </p>
  );
}

/** 两个表单共用的三个字段。`id` 前缀串出唯一的 label/input 关联（一行一个编辑弹层）。 */
function InvoiceFields({
  id,
  currency,
  invoice,
}: {
  id: string;
  currency: string;
  invoice?: InvoiceDraft;
}) {
  const t = useTranslations("Invoices.form");
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-customer`}>{t("customerLabel")}</Label>
        <Input
          id={`${id}-customer`}
          name="customerName"
          required
          maxLength={CUSTOMER_NAME_MAX}
          defaultValue={invoice?.customerName}
          placeholder={t("customerPlaceholder")}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-amount`}>{t("amountLabel")}</Label>
        <Input
          id={`${id}-amount`}
          name="amount"
          required
          inputMode="decimal"
          autoComplete="off"
          defaultValue={invoice ? centsToInput(invoice.amount) : undefined}
          placeholder={t("amountPlaceholder")}
        />
        <p className="text-muted-foreground text-xs">
          {t("amountHint", { currency })}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-status`}>{t("statusLabel")}</Label>
        <Select
          id={`${id}-status`}
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
      </div>
    </>
  );
}

/** 新建发票。成功后弹层里换成一张回执，关掉就能在列表里看到新行。 */
export function CreateInvoiceDialog({ currency }: { currency: string }) {
  const t = useTranslations("Invoices.create");
  const tc = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<InvoiceActionState>(idle);
  const [pending, startTransition] = useTransition();

  // 状态留在组件里，关掉就清空：重开是空白表单，不是上一次的回执。
  // 不用 useActionState 的自动形式 —— 它的状态没法手动重置，只能靠 key 重挂载，
  // 而重挂载会打断关闭动画，把遮罩留在页面上一直挡住点击（e2e 里踩到过）。
  function submit(form: FormData) {
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
          <form action={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription>{t("description")}</DialogDescription>
            </DialogHeader>
            <InvoiceFields id="invoice-create" currency={currency} />
            <FormError state={state} />
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                {t("cancel")}
              </DialogClose>
              <Button
                type="submit"
                disabled={pending}
                data-testid="invoice-create-submit"
              >
                {pending ? t("creating") : t("submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 编辑一行。表单一进来就是这一行的值。 */
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
  const [pending, startTransition] = useTransition();

  // 同新建：关掉清空状态，重开回到带当前值的表单，不会停在上一次的回执上。
  function submit(form: FormData) {
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
          <form action={submit} className="flex flex-col gap-4">
            <input type="hidden" name="id" value={invoice.id} />
            <DialogHeader>
              <DialogTitle>
                {t("title", { name: invoice.customerName })}
              </DialogTitle>
              <DialogDescription>{t("description")}</DialogDescription>
            </DialogHeader>
            <InvoiceFields
              id={`invoice-${invoice.id}`}
              currency={currency}
              invoice={invoice}
            />
            <FormError state={state} />
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                {t("cancel")}
              </DialogClose>
              <Button
                type="submit"
                disabled={pending}
                data-testid="invoice-edit-submit"
              >
                {pending ? t("saving") : t("submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 删除确认。删除不可逆：点确认才真的删，失败把错误留在用户眼前。 */
export function DeleteInvoiceDialog({ invoice }: { invoice: InvoiceDraft }) {
  const t = useTranslations("Invoices.delete");
  const tc = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<InvoiceActionState>(idle);
  const [pending, startTransition] = useTransition();

  // 提交自己接：成功才关弹层。不用 useEffect 观察 state 去关 —— 那会在渲染提交里
  // 同步 setState，造成级联渲染（同 src/core/api-keys/dialogs.tsx 的 RevokeKeyDialog）。
  function submit(form: FormData) {
    startTransition(async () => {
      const next = await deleteInvoice(idle, form);
      setState(next);
      if (next.status === "success") setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // 关掉就清掉上一次的结果：重新打开是干净状态。
        if (!next) setState(idle);
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" data-testid="invoice-delete" />
        }
      >
        {t("open")}
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <form action={submit} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={invoice.id} />
          <DialogHeader>
            <DialogTitle>
              {t("title", { name: invoice.customerName })}
            </DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <FormError state={state} />
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t("cancel")}
            </DialogClose>
            <Button
              type="submit"
              variant="destructive"
              disabled={pending}
              data-testid="invoice-delete-confirm"
            >
              {pending ? t("deleting") : t("confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
