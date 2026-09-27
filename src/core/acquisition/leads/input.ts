import { z } from "zod";
export const emailInput = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email());
export const leadToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const leadRequest = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("submit"),
    email: emailInput,
    listId: z.string().max(40),
    consent: z.literal(true),
    website: z.string().max(200).default(""),
    locale: z.string().max(20),
  }),
  z.strictObject({ action: z.literal("confirm"), token: leadToken }),
  z.strictObject({ action: z.literal("withdraw"), token: leadToken }),
]);
export const DAY = 86400_000;
