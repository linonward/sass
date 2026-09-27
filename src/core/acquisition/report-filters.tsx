import { useTranslations } from "next-intl";

import { cn } from "@/core/lib/utils";
import { Button } from "@/core/ui/button";
import { Label } from "@/core/ui/label";

import type { FilterOptions, ReportFilters as FilterValues } from "./report";

/**
 * 渠道筛选：GET 表单，取值在 URL 里（可分享、可刷新），服务端按 context.ts 的
 * 规则重新校验（见 parseReportFilters）。
 *
 * 用原生 select 而不是像 status 筛选那样铺一排链接：三个维度组合起来链接会有几十条，
 * 而且只有取值多的时候才需要它。外观照 `Input`，产品语域用同一条发丝边。
 */
const selectClass = cn(
  "border-border focus-visible:border-ring focus-visible:ring-ring/50 h-8 min-w-40 rounded-lg border bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:ring-3",
);

/** unknown / direct 是口径里的两个桶，显示成文案里的名字，其他取值原样显示。 */
export function sourceLabel(
  value: string,
  labels: { unknown: string; direct: string },
) {
  return value === "unknown" || value === "direct" ? labels[value] : value;
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
      // 只有来源这一列有 unknown / direct 两个桶，medium / campaign 原样显示
      //（一个叫 direct 的 utm_medium 不是那个桶）。
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

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      {/* 30 天是默认值，不写进 URL（和 RangeFilter 一致）。 */}
      {range !== 30 && <input type="hidden" name="range" value={range} />}
      {fields.map((field) => (
        <div key={field.name} className="grid gap-1.5">
          <Label htmlFor={`filter-${field.name}`}>{field.label}</Label>
          <select
            id={`filter-${field.name}`}
            name={field.name}
            // 手写的 URL 里可能是一个当前数据里没有的取值：带上它，
            // 框里才不会显示成「全部」而结果却是空的。
            defaultValue={field.value ?? ""}
            className={selectClass}
          >
            <option value="">{field.any}</option>
            {[
              ...new Set([
                ...field.values,
                ...(field.value ? [field.value] : []),
              ]),
            ]
              .sort((a, b) => a.localeCompare(b))
              .map((value) => (
                <option key={value} value={value}>
                  {field.format(value)}
                </option>
              ))}
          </select>
        </div>
      ))}
      {/* 这一屏唯一的实心主操作。 */}
      <Button type="submit">{tFilter("apply")}</Button>
    </form>
  );
}
