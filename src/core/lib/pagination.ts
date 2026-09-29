/** Parses `?page=`: a positive integer, anything else is page 1. */
export function parsePage(value: unknown): number {
  const page = Number(typeof value === "string" ? value : undefined);
  return Number.isInteger(page) && page > 0 ? page : 1;
}
