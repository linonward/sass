import { useTranslations } from "next-intl";

import { Button } from "@/core/ui/button";
import { Label } from "@/core/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/select";

import {
  NO_SOURCE_BUCKET,
  type FilterOptions,
  type ReportFilters as FilterValues,
} from "./report";

/**
 * Channel filters: a GET form with the values in the URL (shareable, survives a refresh), which
 * the server re-validates using the rules in context.ts (see parseReportFilters).
 *
 * Uses selects rather than a row of links like the status filter: three dimensions
 * combined would be dozens of links, and it only matters when there are many values.
 * Each select is a Base UI Select; the hidden input rendered for `name` carries the
 * value into the URL with the GET form.
 */
/**
 * The synthetic bucket (no attribution row / withdrawn) is shown with its name from the messages;
 * snapshot values are shown as is — traffic that really sets utm_source to unknown is its own row
 * and must not display the same word as "no attribution". direct is a real snapshot value (visits
 * with no marketing source), and it still gets its name from the messages.
 */
export function sourceLabel(
  value: string,
  labels: { unknown: string; direct: string },
) {
  if (value === NO_SOURCE_BUCKET) return labels.unknown;
  return value === "direct" ? labels.direct : value;
}

export function ReportFilters({
  action,
  options,
  current,
  range,
}: {
  action: string;
  options: FilterOptions;
  current: FilterValues;
  range: number;
}) {
  const t = useTranslations("Admin.acquisition");
  const tFilter = useTranslations("Admin.acquisition.filters");
  const labels = { unknown: t("unknown"), direct: t("direct") };
  const fields = [
    {
      name: "source",
      label: tFilter("source"),
      any: tFilter("allSources"),
      values: options.sources,
      value: current.source,
      // Only the source column has the unknown / direct buckets; medium / campaign are shown as is
      // (a utm_medium called direct is not that bucket).
      format: (value: string) => sourceLabel(value, labels),
    },
    {
      name: "medium",
      label: tFilter("medium"),
      any: tFilter("allMediums"),
      values: options.mediums,
      value: current.medium,
      format: (value: string) => value,
    },
    {
      name: "campaign",
      label: tFilter("campaign"),
      any: tFilter("allCampaigns"),
      values: options.campaigns,
      value: current.campaign,
      format: (value: string) => value,
    },
  ];

  // "All" is the empty string: it submits as `?source=`, and the page treats an
  // empty value as absent on the server.
  const withItems = (field: (typeof fields)[number]) => ({
    ...field,
    items: [
      { value: "", label: field.any },
      ...[...new Set([...field.values, ...(field.value ? [field.value] : [])])]
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: field.format(value) })),
    ],
  });

  // A client-side navigation that only changes searchParams doesn't remount the nodes, so React no
  // longer applies the new defaultValue to the select's current value (verified: after an in-place
  // update the select stays on the old value and only changes on remount), and the filter shown in
  // the dropdown drifts from the one the table actually uses. Keying on the URL keeps them the same
  // value. Empty = all; the page drops empty values from the URL on the server (parseReportFilters
  // already treats an empty string as absent).
  const urlKey = JSON.stringify([
    range,
    current.source ?? "",
    current.medium ?? "",
    current.campaign ?? "",
  ]);

  return (
    <form
      key={urlKey}
      action={action}
      className="flex flex-wrap items-end gap-3"
    >
      {/* 30 days is the default and isn't written to the URL (same as RangeFilter). */}
      {range !== 30 && <input type="hidden" name="range" value={range} />}
      {fields.map(withItems).map((field) => (
        <div key={field.name} className="grid gap-1.5">
          <Label htmlFor={`filter-${field.name}`}>{field.label}</Label>
          <Select
            id={`filter-${field.name}`}
            name={field.name}
            // A hand-written URL may carry a value that isn't in the current data: include it, so
            // the select doesn't show "all" while the results are empty.
            defaultValue={field.value ?? ""}
            items={field.items}
          >
            <SelectTrigger className="min-w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {field.items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
      {/* The only solid primary action on this screen. */}
      <Button type="submit">{tFilter("apply")}</Button>
    </form>
  );
}
