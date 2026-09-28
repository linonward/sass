"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { getSession } from "@/core/auth/session";
import { getDb } from "@/core/db";

import { parseInvoiceForm } from "./invoices";
import { invoices } from "./schema";

import siteConfig from "../../../site.config";

// 示例业务模块的写操作：创建 / 更新 / 删除。三件事都按同一套来：
// 模块开关 → 登录 → 校验 → 带 user_id 条件的 SQL → refresh()。
// 列表页和表单见 ./page.tsx 和 ./dialogs.tsx。

export type InvoiceErrorCode =
  "invalid" | "unauthorized" | "not_found" | "unavailable";

export type InvoiceActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; error: InvoiceErrorCode };

const idSchema = z.uuid();

const CANCELLED: InvoiceActionState = { status: "error", error: "unavailable" };
const UNAUTHORIZED: InvoiceActionState = {
  status: "error",
  error: "unauthorized",
};
const INVALID: InvoiceActionState = { status: "error", error: "invalid" };
const NOT_FOUND: InvoiceActionState = { status: "error", error: "not_found" };

/** 建一张发票，归属当前登录用户。 */
export async function createInvoice(
  _prev: InvoiceActionState,
  form: FormData,
): Promise<InvoiceActionState> {
  // action 是公开端点：模块关掉之后页面 404 了，这里也要再挡一次。
  if (!siteConfig.features.examples.invoices) return CANCELLED;
  const session = await getSession();
  if (!session) return UNAUTHORIZED;
  const input = parseInvoiceForm(form);
  if (!input.ok) return INVALID;

  await getDb()
    .insert(invoices)
    .values({ userId: session.user.id, ...input.data });
  // 列表是服务端渲染的，改完要让它重新渲染一次才看得到新行。
  refresh();
  return { status: "success" };
}

/** 改一张发票。id 不属于当前用户时按「查不到」处理，不动任何数据。 */
export async function updateInvoice(
  _prev: InvoiceActionState,
  form: FormData,
): Promise<InvoiceActionState> {
  if (!siteConfig.features.examples.invoices) return CANCELLED;
  const session = await getSession();
  if (!session) return UNAUTHORIZED;
  const id = idSchema.safeParse(form.get("id"));
  const input = parseInvoiceForm(form);
  if (!id.success || !input.ok) return INVALID;

  const updated = await getDb()
    .update(invoices)
    .set(input.data)
    .where(and(eq(invoices.id, id.data), eq(invoices.userId, session.user.id)))
    .returning({ id: invoices.id });
  // 一行都没改到 = 这张发票不存在，或者不是你的 —— 两种都不该改到别人的数据。
  if (updated.length === 0) return NOT_FOUND;

  refresh();
  return { status: "success" };
}

/** 删除一张发票。归属校验同上。 */
export async function deleteInvoice(
  _prev: InvoiceActionState,
  form: FormData,
): Promise<InvoiceActionState> {
  if (!siteConfig.features.examples.invoices) return CANCELLED;
  const session = await getSession();
  if (!session) return UNAUTHORIZED;
  const id = idSchema.safeParse(form.get("id"));
  if (!id.success) return INVALID;

  const deleted = await getDb()
    .delete(invoices)
    .where(and(eq(invoices.id, id.data), eq(invoices.userId, session.user.id)))
    .returning({ id: invoices.id });
  if (deleted.length === 0) return NOT_FOUND;

  refresh();
  return { status: "success" };
}
