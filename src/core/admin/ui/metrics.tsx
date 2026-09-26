import { useTranslations } from "next-intl";

import { Link } from "@/core/i18n/navigation";
import { cn } from "@/core/lib/utils";
import { buttonVariants } from "@/core/ui/button";

import type { DailyPoint, MetricRange } from "../metrics";
import { metricRanges } from "../metrics";

/** 时间范围切换：一排链接，服务端按 ?range= 统计。 */
export function RangeFilter({ current }: { current: MetricRange }) {
  const t = useTranslations("Admin.metrics.range");
  return (
    <nav aria-label={t("label")} className="flex flex-wrap gap-1.5">
      {metricRanges.map((range) => {
        const active = range === current;
        return (
          <Link
            key={range}
            href={{
              pathname: "/admin/metrics",
              query: range === 30 ? {} : { range: String(range) },
            }}
            aria-current={active ? "page" : undefined}
            className={cn(
              // 和 StatusFilter 同一套：激活是中性填充，未激活是 ghost。
              buttonVariants({
                variant: active ? "secondary" : "ghost",
                size: "sm",
              }),
              !active && "text-muted-foreground",
            )}
          >
            {t("days", { days: range })}
          </Link>
        );
      })}
    </nav>
  );
}

export function MetricSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-4">
      <div className="space-y-1">
        <h2 className="heading-display text-lg">{title}</h2>
        {description && (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</dl>;
}

/** 一个指标：标签、数值，可选一行说明。 */
export function StatTile({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  testId?: string;
}) {
  return (
    <div className="panel flex flex-col gap-1 p-4" data-testid={testId}>
      <dt className="text-muted-foreground text-sm">{label}</dt>
      {/* data-numeric：轮询刷新时数字不跳。 */}
      <dd className="heading-display text-2xl" data-numeric>
        {value}
      </dd>
      {hint && <dd className="text-muted-foreground text-xs">{hint}</dd>}
    </div>
  );
}

/** 不小于 value 的「整齐」刻度：1 / 2 / 5 × 10^n。 */
export function niceCeil(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((s) => s * magnitude >= value)!;
  return step * magnitude;
}

/**
 * 按天的柱状图（单一系列）：CSS 画柱子，悬停或聚焦显示当天的数值，
 * 下方可以展开数据表。
 */
export function DailyColumns({
  title,
  points,
  formatValue,
  formatDay,
}: {
  title: string;
  points: DailyPoint[];
  formatValue: (value: number) => string;
  formatDay: (day: string) => string;
}) {
  const t = useTranslations("Admin.metrics.chart");
  const max = niceCeil(Math.max(0, ...points.map((p) => p.value)));

  return (
    <figure className="panel flex flex-col gap-3 p-4">
      <figcaption className="heading-display text-sm">{title}</figcaption>
      <div className="flex gap-2">
        {/* y 轴：只标 0 和最大刻度。 */}
        <div className="text-muted-foreground flex h-40 flex-col justify-between text-right text-xs tabular-nums">
          <span className="-translate-y-1/2">{formatValue(max)}</span>
          <span className="translate-y-1/2">{formatValue(0)}</span>
        </div>
        <div className="relative h-40 flex-1">
          <div
            aria-hidden
            className="border-border absolute inset-x-0 top-0 border-t"
          />
          <div
            aria-hidden
            className="border-border absolute inset-x-0 bottom-0 border-t"
          />
          <ol className="absolute inset-0 flex items-end gap-0.5">
            {points.map((point) => {
              const label = `${formatDay(point.day)}: ${formatValue(point.value)}`;
              return (
                <li
                  key={point.day}
                  tabIndex={0}
                  aria-label={label}
                  className="group relative flex h-full min-w-0 flex-1 items-end justify-center outline-none"
                >
                  {point.value > 0 && (
                    <div
                      className="bg-primary group-hover:bg-primary/80 group-focus-visible:bg-primary/80 w-full max-w-6 rounded-t-[4px]"
                      style={{
                        height: `max(2px, ${(point.value / max) * 100}%)`,
                      }}
                    />
                  )}
                  <div
                    role="tooltip"
                    className="bg-popover text-popover-foreground sticker pointer-events-none absolute bottom-full z-10 mb-1 hidden rounded-md px-2 py-1 text-xs whitespace-nowrap group-hover:block group-focus-visible:block"
                  >
                    <div className="text-muted-foreground">
                      {formatDay(point.day)}
                    </div>
                    <div className="font-medium tabular-nums">
                      {formatValue(point.value)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      <div className="text-muted-foreground flex justify-between pl-2 text-xs">
        <span>{points[0] && formatDay(points[0].day)}</span>
        <span>{points.at(-1) && formatDay(points.at(-1)!.day)}</span>
      </div>
      <details className="text-sm">
        <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs">
          {t("showData")}
        </summary>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-muted-foreground text-left">
              <th className="py-1 font-medium">{t("day")}</th>
              <th className="py-1 text-right font-medium">{t("value")}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.day} className="border-border border-t">
                <td className="py-1">{formatDay(point.day)}</td>
                <td className="py-1 text-right tabular-nums">
                  {formatValue(point.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

export function ChartGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-3 lg:grid-cols-2", className)}>{children}</div>
  );
}
