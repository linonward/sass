import { notFound } from "next/navigation";

// Make unmatched paths under [locale] render the localized not-found.tsx.
export default function CatchAll() {
  notFound();
}
