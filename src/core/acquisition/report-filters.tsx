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
 * 渠道筛选：GET 表单，取值在 URL 里（可分享、可刷新），服务端按 context.ts 的
 * 规则重新校验（见 parseReportFilters）。
 *
 * Uses selects rather than a row of links like the status filter: three dimensions
 * combined would be dozens of links, and it only matters when there are many values.
 * Each select is a Base UI Select; the hidden input rendered for `name` carries the
 * value into the URL with the GET form.
 */
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

  // 换了 searchParams 的客户端跳转不会重新挂载节点，React 也就不再把新的
  // defaultValue 应用到 select 的当前值上（实测：同树更新后框里停在旧值，
  // 只有重挂才会变），于是下拉显示的筛选和表格实际用的筛选会对不上。
  // key 跟着 URL 走，两者就始终是同一份取值。留空 = 全部，空值由页面在服务端
  // 从 URL 里收掉（parseReportFilters 本来就把空串当没传）。
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
      {/* 30 天是默认值，不写进 URL（和 RangeFilter 一致）。 */}
      {range !== 30 && <input type="hidden" name="range" value={range} />}
      {fields.map(withItems).map((field) => (
        <div key={field.name} className="grid gap-1.5">
          <Label htmlFor={`filter-${field.name}`}>{field.label}</Label>
          <Select
            id={`filter-${field.name}`}
            name={field.name}
            // 手写的 URL 里可能是一个当前数据里没有的取值：带上它，
            // 框里才不会显示成「全部」而结果却是空的。
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
      {/* 这一屏唯一的实心主操作。 */}
      <Button type="submit">{tFilter("apply")}</Button>
    </form>
  );
}
