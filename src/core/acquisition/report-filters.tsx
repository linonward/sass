import { useTranslations } from "next-intl";

import { cn } from "@/core/lib/utils";
import { Button } from "@/core/ui/button";
import { Label } from "@/core/ui/label";

import {
  NO_SOURCE_BUCKET,
  type FilterOptions,
  type ReportFilters as FilterValues,
} from "./report";

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

/**
 * 合成桶（没有归因行 / 已撤回）显示成文案里的名字；快照里的取值原样显示 —— 真的把
 * utm_source 填成 unknown 的流量是独立的一行，不能和「没有归因」显示成同一个词。
 * direct 是快照里真实存在的一个取值（没有营销来源的访问），照旧给它文案里的名字。
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
