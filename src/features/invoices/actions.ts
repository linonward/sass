"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { getSession } from "@/core/auth/session";
import { getDb } from "@/core/db";

import { parseInvoiceForm } from "./invoices";
import { invoices } from "./schema";

import siteConfig from "../../../site.config";

// Writes for the example business module: create / update / delete. All three follow the same
// sequence: module switch → sign-in → validation → SQL scoped by user_id → refresh().
// The list page and forms are in ./page.tsx and ./dialogs.tsx.

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

/** Create an invoice owned by the signed-in user. */
export async function createInvoice(
  _prev: InvoiceActionState,
  form: FormData,
): Promise<InvoiceActionState> {
  // An action is a public endpoint: once the module is off the page 404s, but block it here too.
  if (!siteConfig.features.examples.invoices) return CANCELLED;
  const session = await getSession();
  if (!session) return UNAUTHORIZED;
  const input = parseInvoiceForm(form);
  if (!input.ok) return INVALID;

  await getDb()
    .insert(invoices)
    .values({ userId: session.user.id, ...input.data });
  // The list is server-rendered; it has to render again after a change for the new row to show.
  refresh();
  return { status: "success" };
}

/** Update an invoice. An id that isn't the current user's is treated as not found; no data changes. */
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
  // No rows updated = the invoice doesn't exist or isn't yours — neither case may touch anyone
  // else's data.
  if (updated.length === 0) return NOT_FOUND;

  refresh();
  return { status: "success" };
}

/** Delete an invoice. Same ownership check as above. */
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
