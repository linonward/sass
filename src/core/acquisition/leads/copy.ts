import { z } from "zod";
const copySchema = z.record(
  z.string(),
  z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    consent: z.string().min(1),
  }),
);
export function leadListCopy(raw: unknown, id: string) {
  const copy = z.object({ Leads: z.object({ lists: copySchema }) }).parse(raw)
    .Leads.lists[id];
  if (!copy)
    throw new Error(`Missing Leads.lists copy for configured list: ${id}`);
  return copy;
}
